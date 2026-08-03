import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export function loadActorConfiguration(path) {
  const configuration = JSON.parse(readFileSync(path, "utf8"));
  if (configuration?.type !== "BareCedarFogCodexInVsCodeConfiguration") throw new Error("expected a Bare Cedar Fog Codex-in-VS-Code configuration");
  if (configuration.actor !== "urn:ame:bare-cedar-fog-codex") throw new Error("configuration must belong to the stable Bare Cedar Fog Codex actor");
  if (configuration.surface !== "vscode-codex") throw new Error("configuration must describe the VS Code Codex surface");
  if (configuration.projection?.template !== "projection") throw new Error("configuration must name its colocated projection template");
  if (configuration.projection.skills !== undefined) throw new Error("projected skills are forbidden: capabilities belong to external enterprise actuator faces, not the harness projection");
  if (!Array.isArray(configuration.projection.files) || configuration.projection.files.length === 0) throw new Error("projection must name a nonempty file allowlist");
  for (const path of configuration.projection.files) {
    if (typeof path !== "string" || path === "" || path.startsWith("/") || path.split("/").includes("..")) throw new Error("projection files must be safe relative paths");
  }
  return configuration;
}

function files(root, directory = root) {
  const result = [];
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, name.name);
    if (name.isDirectory()) result.push(...files(root, path)); else if (name.isFile()) result.push(relative(root, path));
  }
  return result.sort();
}

export function projectCodexHarness({ configurationPath, target }) {
  configurationPath = resolve(configurationPath);
  const configuration = loadActorConfiguration(configurationPath);
  if (typeof target !== "string" || target.trim() === "") throw new Error("an explicit output directory is required");
  const codex = resolve(target);
  const template = join(dirname(configurationPath), configuration.projection.template);
  if (!existsSync(template)) throw new Error(`projection template is absent: ${template}`);
  mkdirSync(codex, { recursive: true });
  // The explicitly named output directory is entirely disposable runtime projection. Durable
  // knowledge, handoffs, and capabilities belong to their owning enterprises.
  // In particular, never recreate the historical .codex/skills source sink.
  const allowed = new Set(configuration.projection.files);
  for (const path of files(codex)) if (!allowed.has(path)) rmSync(join(codex, path), { force: true });
  const prune = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) prune(join(directory, entry.name));
    if (directory !== codex && readdirSync(directory).length === 0) rmdirSync(directory);
  };
  prune(codex);
  for (const path of allowed) {
    const source = join(template, path);
    if (!existsSync(source)) throw new Error(`allowed projection file is absent: ${path}`);
    const destination = join(codex, path); mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination, { force: true });
  }
  const projected = files(codex);
  return Object.freeze({ actor: configuration.actor, target: codex, files: projected });
}
