import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const requiredPythonEntrypoints = [
  "run-one-exchange.py",
  "reconcile-notebook-sources.py",
];
const sourceRoots = ["src", "lib", "scripts", "test"];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function check(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} exited with status ${result.status}`);
  }
}

for (const entrypoint of requiredPythonEntrypoints) {
  const path = join(root, entrypoint);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`required Python entrypoint is absent: ${entrypoint}`);
  }
}

const sources = [
  ...sourceRoots.flatMap((directory) => filesBelow(join(root, directory))),
  ...requiredPythonEntrypoints.map((path) => join(root, path)),
];

for (const path of sources) {
  const extension = extname(path);
  if (extension === ".js" || extension === ".mjs") {
    check(process.execPath, ["--check", path]);
  } else if (extension === ".py") {
    check(
      "python3",
      ["-c", "import ast,sys; ast.parse(sys.stdin.buffer.read(), filename=sys.argv[1])", relative(root, path)],
      { input: readFileSync(path) },
    );
  }
}

process.stdout.write(`checked ${sources.length} JavaScript and Python sources\n`);
