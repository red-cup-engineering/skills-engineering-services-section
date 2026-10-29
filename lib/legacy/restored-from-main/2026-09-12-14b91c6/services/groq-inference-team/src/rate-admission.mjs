import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function defaultPause(milliseconds) { if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }

export function admitRateState({
  statePath,
  minimumIntervalMilliseconds,
  now = Date.now(),
  pause = defaultPause,
} = {}) {
  if (typeof statePath !== "string" || statePath.length === 0) throw new Error("one provider-local rate-state path is required");
  if (!Number.isInteger(minimumIntervalMilliseconds) || minimumIntervalMilliseconds < 0 || minimumIntervalMilliseconds > 180_000) throw new Error("minimum live exchange interval must be 0..180000 milliseconds");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("rate admission time must be a nonnegative safe integer");
  let prior = 0;
  if (existsSync(statePath)) {
    const text = readFileSync(statePath, "utf8");
    if (!/^(0|[1-9][0-9]*)\n?$/u.test(text)) throw new Error("provider-local rate state is malformed");
    prior = Number(text.trim());
    if (!Number.isSafeInteger(prior)) throw new Error("provider-local rate state is outside the safe time range");
  }
  const delay = Math.max(0, minimumIntervalMilliseconds - (now - prior));
  pause(delay);
  const admittedAt = now + delay;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${admittedAt}\n`, "utf8");
  return Object.freeze({ admittedAt, delayMilliseconds: delay });
}
