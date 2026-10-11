#!/usr/bin/env node
// measure-claude-session-spend.mjs — Claude Code session spend meter (claude-code-services-section).
//
// Reads Claude Code session transcripts (~/.claude/projects/<proj>/<id>.jsonl
// plus <id>/subagents/*.jsonl) and prices every API request at Anthropic's
// published first-party rates, attributing each request's full cost to the
// activity (tool call) the request performed.
//
// Usage:
//   node scripts/measure-claude-session-spend.mjs <session-id-or-jsonl> [--project <dir>] [--json]
//
// Attribution model: an assistant API response's cost (uncached input +
// cache writes + cache reads + output) is caused by whatever the harness
// asked the model to do on that turn; we bill it to the tool(s) the response
// invoked (or "text-only"). Bash calls are sub-categorized by command head.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// $ per MTok, Anthropic first-party published rates (claude-api skill,
// cached 2026-06-24). Cache write: 1.25x input (5m TTL), 2x input (1h TTL).
// Cache read: 0.1x input. Sonnet 5 intro pricing applies through 2026-08-31.
const RATES = [
  { match: /^claude-fable-5/, input: 10, output: 50 },
  { match: /^claude-mythos-5/, input: 10, output: 50 },
  { match: /^claude-opus-5/, input: 5, output: 25 },
  { match: /^claude-opus-4/, input: 5, output: 25 },
  { match: /^claude-sonnet-5/, input: sonnetIntroActive() ? 2 : 3, output: sonnetIntroActive() ? 10 : 15 },
  { match: /^claude-sonnet-4/, input: 3, output: 15 },
  { match: /^claude-haiku-4-5/, input: 1, output: 5 },
];

function sonnetIntroActive() {
  return new Date() <= new Date('2026-08-31T23:59:59Z');
}

function rateFor(model) {
  const r = RATES.find((r) => r.match.test(model || ''));
  return r || null;
}

function priceUsage(model, u) {
  const r = rateFor(model);
  if (!r) return { cost: 0, unpriced: true };
  const perTok = r.input / 1e6;
  const perOut = r.output / 1e6;
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens ?? null;
  const w1 = cc.ephemeral_1h_input_tokens ?? null;
  let writeCost;
  if (w5 !== null || w1 !== null) {
    writeCost = (w5 || 0) * 1.25 * perTok + (w1 || 0) * 2 * perTok;
  } else {
    // No breakdown: Claude Code sessions run the 1h TTL — assume 2x.
    writeCost = (u.cache_creation_input_tokens || 0) * 2 * perTok;
  }
  const cost =
    (u.input_tokens || 0) * perTok +
    writeCost +
    (u.cache_read_input_tokens || 0) * 0.1 * perTok +
    (u.output_tokens || 0) * perOut;
  return { cost, unpriced: false };
}

function categorize(content) {
  if (!Array.isArray(content)) return ['text-only'];
  const cats = [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      if (block.name === 'Bash') {
        const cmd = String(block.input?.command || '').trim();
        let head = cmd.split(/\s+/)[0] || '?';
        head = path.basename(head);
        // the repo's git wrapper counts as git
        if (/^git/.test(head)) head = 'git';
        cats.push(`Bash:${head}`);
      } else if (block.name === 'Agent' || block.name === 'Task') {
        cats.push(`Agent:${block.input?.subagent_type || block.input?.description || '?'}`);
      } else {
        cats.push(block.name);
      }
    }
  }
  return cats.length ? cats : ['text-only'];
}

function* records(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      /* skip malformed */
    }
  }
}

function measureFile(file, streamLabel, acc) {
  const seen = acc.seenMessageIds;
  for (const o of records(file)) {
    if (o.type !== 'assistant') continue;
    const m = o.message || {};
    const u = m.usage;
    if (!u) continue;
    const id = m.id || o.requestId || o.uuid;
    if (seen.has(id)) {
      // Later chunks of the same message may add content blocks; remember
      // categories but do not re-count usage.
      const entry = seen.get(id);
      for (const c of categorize(m.content)) entry.cats.add(c);
      continue;
    }
    const entry = {
      stream: streamLabel,
      model: m.model || '?',
      usage: {
        input_tokens: u.input_tokens || 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cache_creation: u.cache_creation || null,
      },
      cats: new Set(categorize(m.content)),
      ts: o.timestamp,
    };
    seen.set(id, entry);
  }
}

function aggregate(acc) {
  const byModel = {};
  const byStream = {};
  const byCategory = {};
  const totals = { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
  for (const entry of acc.seenMessageIds.values()) {
    const { cost, unpriced } = priceUsage(entry.model, entry.usage);
    const u = entry.usage;
    totals.requests += 1;
    totals.input += u.input_tokens;
    totals.cacheWrite += u.cache_creation_input_tokens;
    totals.cacheRead += u.cache_read_input_tokens;
    totals.output += u.output_tokens;
    totals.cost += cost;
    for (const [key, map] of [
      [entry.model + (unpriced ? ' (UNPRICED)' : ''), byModel],
      [entry.stream, byStream],
    ]) {
      const b = (map[key] ||= { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 });
      b.requests += 1;
      b.input += u.input_tokens;
      b.cacheWrite += u.cache_creation_input_tokens;
      b.cacheRead += u.cache_read_input_tokens;
      b.output += u.output_tokens;
      b.cost += cost;
    }
    // Split this request's cost evenly across its categories.
    const cats = [...entry.cats];
    for (const c of cats) {
      const b = (byCategory[c] ||= { requests: 0, output: 0, cost: 0 });
      b.requests += 1 / cats.length;
      b.output += u.output_tokens / cats.length;
      b.cost += cost / cats.length;
    }
  }
  return { totals, byModel, byStream, byCategory };
}

function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
}

function printTable(title, map, extraCols = true) {
  console.log(`\n== ${title} ==`);
  const rows = Object.entries(map).sort((a, b) => b[1].cost - a[1].cost);
  for (const [k, v] of rows) {
    const cols = [
      `$${v.cost.toFixed(2)}`.padStart(9),
      `${String(Math.round(v.requests)).padStart(5)} req`,
      `out ${fmt(v.output).padStart(7)}`,
    ];
    if (extraCols && 'input' in v) {
      cols.push(`in ${fmt(v.input).padStart(7)}`, `cw ${fmt(v.cacheWrite).padStart(7)}`, `cr ${fmt(v.cacheRead).padStart(8)}`);
    }
    console.log(cols.join('  ') + '  ' + k);
  }
}

// ---- main ----
const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: measure-claude-session-spend.mjs <session-id-or-jsonl> [--json]');
  process.exit(2);
}

let mainFile;
if (fs.existsSync(target) && target.endsWith('.jsonl')) {
  mainFile = path.resolve(target);
} else {
  const projDir = path.join(os.homedir(), '.claude', 'projects');
  const hits = [];
  for (const proj of fs.readdirSync(projDir)) {
    const p = path.join(projDir, proj, target + '.jsonl');
    if (fs.existsSync(p)) hits.push(p);
  }
  if (!hits.length) {
    console.error(`no transcript found for session ${target}`);
    process.exit(1);
  }
  mainFile = hits[0];
}

const acc = { seenMessageIds: new Map() };
measureFile(mainFile, 'main', acc);
const sideDir = mainFile.replace(/\.jsonl$/, '');
const subDir = path.join(sideDir, 'subagents');
if (fs.existsSync(subDir)) {
  for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))) {
    measureFile(path.join(subDir, f), `subagent:${f.replace(/\.jsonl$/, '')}`, acc);
  }
}

const result = aggregate(acc);
if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const t = result.totals;
  console.log(`session: ${path.basename(mainFile, '.jsonl')}`);
  console.log(
    `totals: ${t.requests} requests | in ${fmt(t.input)} | cache-write ${fmt(t.cacheWrite)} | cache-read ${fmt(t.cacheRead)} | out ${fmt(t.output)} | cost $${t.cost.toFixed(2)}`,
  );
  printTable('by model', result.byModel);
  printTable('by stream', result.byStream);
  printTable('by activity (request cost billed to the tool called)', result.byCategory, false);
}
