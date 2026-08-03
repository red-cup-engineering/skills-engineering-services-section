#!/usr/bin/env node
/**
 * cwe-serve — the HTTP/OpenAPI/MCP/web-UX transport over the cockpit actions.
 *
 * The transports are functorial images of the one `induceBins` apex: CLI is the
 * `cwe` dispatcher; this binds the same actions to a `node:http` server exposing
 * `GET /` (web index), `GET /:verb` (HTML form), `POST /:verb`, `GET
 * /openapi.json`, and `POST /mcp`. Every POST runs through `dispatch`, so HTTP/MCP
 * calls are witnessed as EAVT like CLI calls.
 *
 *   PORT=8788 CWE_DATA=.tmp/data cwe-serve
 */
import { fileURLToPath } from "node:url";
import { induceBins } from "@emsenn/relating";
import { serve } from "@emsenn/relating/running";
import { actions } from "../src/actions.mjs";

function main(): void {
  const port = Number(process.env["PORT"] ?? 8788);
  const dataRoot = process.env["CWE_DATA"];
  const induced = induceBins(actions, { packageName: "@emsenn/computing-with-emacs" });
  const server = serve(actions, {
    induced,
    title: "@emsenn/computing-with-emacs",
    ...(dataRoot === undefined ? {} : { dataRoot }),
    caller: { transport: "http" },
  });
  server.listen(port, () => {
    process.stdout.write(`cwe-serve: ${induced.actions.length} operations on http://localhost:${port}/\n`);
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
