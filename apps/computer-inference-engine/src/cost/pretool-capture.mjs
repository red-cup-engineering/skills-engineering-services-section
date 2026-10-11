import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/cost/run-captured-command.mjs");

export function readOnlyCommand(command) {
  if (typeof command !== "string" || !/^[A-Za-z0-9_./:=@%+, \t-]+$/u.test(command)) return false;
  const argv = command.trim().split(/\s+/u);
  if (argv[0] === "git") return argv[1] === "status" && argv.slice(2).every((value) => ["--short", "--branch", "-s", "-b"].includes(value));
  if (!["rg", "grep"].includes(argv[0])) return false;
  const flags = new Set(["-n", "-i", "-F", "--line-number", "--ignore-case", "--fixed-strings"]);
  const values = argv.slice(1);
  return values.length >= 1 && values.every((value) => !value.startsWith("-") || flags.has(value)) && values.filter((value) => !flags.has(value)).length >= 1;
}

export function captureRewrite(input) {
  const toolInput = input?.tool_input ?? {}, commandField = typeof toolInput.command === "string" ? "command" : typeof toolInput.cmd === "string" ? "cmd" : null;
  const command = commandField ? toolInput[commandField] : null;
  const cwd = [toolInput.workdir, input?.workdir, toolInput.cwd, input?.cwd].find((value) => typeof value === "string" && value.trim());
  if (!readOnlyCommand(command) || !cwd) return null;
  const tokens = Number.isSafeInteger(toolInput.max_output_tokens) ? Math.min(4000, Math.max(1, toolInput.max_output_tokens)) : 3072;
  if (tokens < 128) return null;
  const request = Buffer.from(JSON.stringify({ command, cwd: resolve(cwd), maximumRenderBytes: tokens * 4 })).toString("base64url");
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return Object.freeze({ ...toolInput, [commandField]: `${quote(process.execPath)} ${quote(RUNNER)} --request ${request}` });
}
