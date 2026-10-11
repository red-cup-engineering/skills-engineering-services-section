#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, unwatchFile, watchFile } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { boundedInteger, createInferenceBroker, safeRefusal } from "../../src/fabric/inference-broker.mjs";
import { attachInferenceJsonlSession } from "../../src/fabric/inference-jsonl-session.mjs";
import { createInferenceActivityStreams } from "../../src/fabric/inference-activitystreams.mjs";
import { fileURLToPath } from "node:url";

const valued = new Set(["registry", "socket", "concurrency", "attempts", "max-queue-depth", "max-seen-ids", "history", "journal", "activitystreams-data-root", "max-connections", "max-line-bytes", "max-write-buffer-bytes", "shutdown-grace-ms"]), booleans = new Set(["recover-stale-lock", "recover-stale-socket", "restart-on-registry-change", "help"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
function activationFd(environment = process.env) { if (environment.LISTEN_PID !== String(process.pid)) return null; const count = Number(environment.LISTEN_FDS ?? 0); if (!Number.isInteger(count) || count !== 1) throw new Error("systemd activation requires exactly one inherited descriptor"); return 3; }
const listen = (server, options) => new Promise((resolveListen, rejectListen) => { const failed = (error) => { server.off("listening", ready); rejectListen(error); }, ready = () => { server.off("error", failed); resolveListen(); }; server.once("error", failed); server.once("listening", ready); server.listen(options); });
const waitForSocketClose = async (sockets, graceMs) => {
  let timer;
  await Promise.race([
    Promise.allSettled([...sockets].map((socket) => socket.destroyed ? Promise.resolve() : new Promise((resolveClose) => socket.once("close", resolveClose)))),
    new Promise((resolveGrace) => { timer = setTimeout(resolveGrace, graceMs); })
  ]);
  clearTimeout(timer);
};

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stderr.write("usage: serve-inference-socket --registry registry.json --journal records.jsonl [--socket path] [--history records.jsonl] [--activitystreams-data-root path] [--concurrency N] [--attempts N] [--max-connections N] [--max-line-bytes N] [--max-write-buffer-bytes N] [--restart-on-registry-change] [--recover-stale-lock] [--recover-stale-socket]\n"); return; }
  if (!args.registry || !args.journal) throw new Error("--registry and --journal are required");
  const inheritedFd = activationFd(), explicitSocket = args.socket ? resolve(args.socket) : null;
  if (inheritedFd !== null && explicitSocket) throw new Error("do not combine systemd socket activation with --socket");
  if (inheritedFd === null && !explicitSocket) throw new Error("--socket is required without systemd socket activation");
  const maxConnections = boundedInteger(args["max-connections"], 64, 1, 4096, "max-connections"), maxLineBytes = boundedInteger(args["max-line-bytes"], 1024 * 1024, 1024, 16 * 1024 * 1024, "max-line-bytes"), maxWriteBufferBytes = boundedInteger(args["max-write-buffer-bytes"], 2 * 1024 * 1024, 1024, 32 * 1024 * 1024, "max-write-buffer-bytes"), shutdownGraceMs = boundedInteger(args["shutdown-grace-ms"], 2000, 100, 30000, "shutdown-grace-ms");
  if (explicitSocket && existsSync(explicitSocket)) { if (!args["recover-stale-socket"]) { const error = new Error("socket path exists; use systemd ownership or --recover-stale-socket to archive it"); error.exitCode = 3; throw error; } renameSync(explicitSocket, `${explicitSocket}.stale-${Date.now()}`); }
  if (explicitSocket) mkdirSync(dirname(explicitSocket), { recursive: true, mode: 0o700 });
  const broker = createInferenceBroker({ registryPath: args.registry, journalPath: args.journal, historyPath: args.history, concurrency: args.concurrency, attempts: args.attempts, maxQueueDepth: args["max-queue-depth"], maxSeenIds: args["max-seen-ids"], recoverStaleLock: args["recover-stale-lock"] });
  const defaultDataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data"), activityStreams = createInferenceActivityStreams({ broker, dataRoot: resolve(args["activitystreams-data-root"] ?? defaultDataRoot) });
  const sessions = new Map(); let stopResolve, stopping = false, fatalError = null, registryChanged = false;
  const stopRequested = new Promise((resolveStop) => { stopResolve = resolveStop; });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    if (sessions.size >= maxConnections) { socket.end(`${JSON.stringify(safeRefusal(null, "connection-capacity"))}\n`); return; }
    socket.setNoDelay(true); const session = attachInferenceJsonlSession({ readable: socket, writable: socket, broker, activityStreams, maxLineBytes, maxWriteBufferBytes, endWritableOnInputEnd: true }); sessions.set(socket, session); session.done.then(() => sessions.delete(socket), () => sessions.delete(socket));
  });
  const requestStop = () => { if (!stopping) { stopping = true; stopResolve(); } };
  process.once("SIGTERM", requestStop); process.once("SIGINT", requestStop);
  try {
    await listen(server, inheritedFd === null ? { path: explicitSocket } : { fd: inheritedFd }); if (explicitSocket) chmodSync(explicitSocket, 0o600);
    server.on("error", (error) => { fatalError = error; requestStop(); });
    if (args["restart-on-registry-change"]) watchFile(broker.ready.registryPath, { interval: 1000 }, (current, previous) => { if (current.mtimeMs !== previous.mtimeMs || current.ino !== previous.ino) { registryChanged = true; requestStop(); } });
    for (const key of ["LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"]) delete process.env[key];
    process.stderr.write(`${JSON.stringify({ type: "InferenceSocketServiceReady", pid: process.pid, activation: inheritedFd === null ? "path" : "systemd", socket: explicitSocket, maxConnections, maxLineBytes, maxWriteBufferBytes, activityStreams: activityStreams.snapshot(), ...broker.ready })}\n`);
    await stopRequested; if (server.listening) server.close(); broker.stop(); for (const session of sessions.values()) session.stopInput(); await broker.drain(); await Promise.allSettled([...sessions.values()].map((session) => session.drain()));
    for (const socket of sessions.keys()) if (!socket.destroyed) socket.end();
    await waitForSocketClose(sessions.keys(), shutdownGraceMs);
    for (const socket of sessions.keys()) if (!socket.destroyed) socket.destroy();
    if (fatalError) throw fatalError;
  } finally { if (args["restart-on-registry-change"]) unwatchFile(broker.ready.registryPath); if (server.listening) server.close(); await broker.close(); if (explicitSocket) { try { unlinkSync(explicitSocket); } catch {} } }
  if (registryChanged) process.exitCode = 75;
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode ?? 2; }
