import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expected = JSON.parse(readFileSync(new URL('./distribution-files.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const strings = (value) => typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(strings);
function pack(directory, cache) {
  return JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline', '--cache', cache], {
    cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_offline: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }))[0].files.map(({ path }) => path).sort();
}
function sameInventory(actual) {
  // Counts only: do not print historical filenames if a boundary regresses.
  assert.equal(actual.filter((path) => !expected.includes(path)).length, 0, 'unreviewed files entered the package');
  assert.equal(expected.filter((path) => !actual.includes(path)).length, 0, 'required distribution files are missing');
}

test('real npm pack inventory matches the reviewed source distribution', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'inference-pack-cache-'));
  try { sameInventory(pack(root, cache)); } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('all exports, bins and literal package-relative imports remain in the distribution', () => {
  for (const target of [...strings(manifest.exports), ...strings(manifest.bin)]) {
    assert.ok(expected.includes(target.replace(/^\.\//u, '')), `missing public entry point: ${target}`);
  }
  for (const path of expected.filter((path) => path.endsWith('.mjs'))) {
    const source = readFileSync(resolve(root, path), 'utf8');
    // Literal ESM imports/re-exports, dynamic imports and require calls. Nonliteral
    // runtime resources are separately reviewed in docs/package-distribution.md.
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.[^"']+)["']/gu)) {
      const target = relative(root, resolve(root, dirname(path), match[1])).replaceAll('\\', '/');
      assert.ok(expected.includes(target), `unpacked relative import: ${path} -> ${target}`);
    }
  }
});

test('new operational records, credentials, history and tests stay excluded', () => {
  const staging = mkdtempSync(resolve(tmpdir(), 'inference-pack-boundary-'));
  const cache = mkdtempSync(resolve(tmpdir(), 'inference-pack-cache-'));
  try {
    for (const path of expected) {
      mkdirSync(dirname(resolve(staging, path)), { recursive: true });
      copyFileSync(resolve(root, path), resolve(staging, path));
    }
    const canaries = ['content/assets/legacy/exchange.json', 'content/assets/legacy/runtime.mjs',
      'data/records/exchange.json', 'data/state/account.json', 'data/logs/witness.jsonl',
      'content/exchanges/turn.json', 'content/resources/inference-account.env',
      'content/dispatch/activation-records/receipt.json', 'content/dispatch/provider-admissions/deployment-receipts/receipt.json',
      'content/dispatch/customer-admissions/unreviewed.json', 'content/openai/providers/unreviewed.json',
      'content/allowances/unreviewed.json', 'content/dispatch/evm/accounts/account.json',
      'content/dispatch/agent-card-signing/key.json', 'scripts/historical-ledger-receiving/reader.mjs',
      'test/unreviewed.test.mjs', '.env', 'SOURCE_PROVENANCE.json'];
    for (const path of canaries) {
      mkdirSync(dirname(resolve(staging, path)), { recursive: true });
      writeFileSync(resolve(staging, path), 'distribution exclusion canary\n');
    }
    // Prove that packaging does not run lifecycle code, even if introduced later.
    writeFileSync(resolve(staging, 'package.json'), JSON.stringify({ ...manifest, scripts: {
      ...manifest.scripts, prepack: 'node -e "process.exit(97)"', prepare: 'node -e "process.exit(98)"',
    } }));
    sameInventory(pack(staging, cache));
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});
