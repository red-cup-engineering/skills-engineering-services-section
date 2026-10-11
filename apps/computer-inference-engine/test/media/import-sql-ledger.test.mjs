import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const SQL = /node:sql|better-sqlite|sqlite3|libsql|sql\.js|DatabaseSync|CREATE (VIRTUAL )?TABLE|INSERT (OR [A-Z]+ )?INTO|SELECT [^"`']* FROM/u;

test("ordinary engine modules contain no SQL reader or runtime SQL engine", () => {
  const holding = readdirSync(source, { recursive: true }).map(String)
    .filter((file) => file.endsWith(".mjs"))
    .filter((file) => SQL.test(readFileSync(path.join(source, file), "utf8")));
  assert.deepEqual(holding, []);
});

