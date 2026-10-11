import { TextDecoder } from "node:util";
import { safeRefusal } from "./inference-broker.mjs";

export function attachInferenceJsonlSession({ readable, writable, broker, activityStreams = null, allowShutdown = false, onShutdown = () => {}, maxLineBytes = 1024 * 1024, maxWriteBufferBytes = 2 * 1024 * 1024, endWritableOnInputEnd = false }) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const tasks = new Set(); let chunks = [], buffered = 0, discarding = false, writes = Promise.resolve(), queuedWriteBytes = 0, inputResolved = false, resolveInput;
  const inputEnded = new Promise((resolveEnded) => { resolveInput = resolveEnded; });
  const finishInput = () => { if (!inputResolved) { inputResolved = true; resolveInput(); } };
  const connected = () => !writable.destroyed && !writable.writableEnded;
  const writeRecord = (record) => {
    if (!connected()) return Promise.resolve(false);
    const encoded = Buffer.from(`${JSON.stringify(record)}\n`);
    if (encoded.length > maxWriteBufferBytes || queuedWriteBytes + encoded.length > maxWriteBufferBytes) { writable.destroy(); return Promise.resolve(false); }
    queuedWriteBytes += encoded.length;
    writes = writes.then(() => connected() ? new Promise((resolveWrite, rejectWrite) => { writable.write(encoded, (error) => error ? rejectWrite(error) : resolveWrite(true)); }) : false).finally(() => { queuedWriteBytes -= encoded.length; });
    return writes.catch(() => false);
  };
  const track = (promise) => { tasks.add(promise); promise.then(() => tasks.delete(promise), () => tasks.delete(promise)); };
  const handleValue = (value) => {
    if (value?.control !== undefined) { if (allowShutdown && value.control === "shutdown") onShutdown(); else track(writeRecord(safeRefusal(value?.id, "control-not-authorized"))); return; }
    if (activityStreams?.recognizes(value)) { track(Promise.resolve().then(() => activityStreams.handle(value)).then(writeRecord, () => writeRecord(safeRefusal(value?.id, "activitystreams-service-failure")))); return; }
    if (value?.type === "InferenceResultQuery") { const record = typeof value.id === "string" ? broker.replay(value.id) : null; track(writeRecord(record ?? safeRefusal(value?.id, "result-not-settled"))); return; }
    if (value?.type === "InferenceMarketSnapshotQuery") { track(writeRecord(broker.marketSnapshot())); return; }
    if (value?.type === "InferenceSubmission") {
      if (value.delivery !== "receipt-only" || !value.job || Object.keys(value).some((key) => !["type", "delivery", "job"].includes(key))) { track(writeRecord(safeRefusal(value?.job?.id ?? value?.id, "invalid-submission-envelope"))); return; }
      const admission = broker.admit(value.job); track(writeRecord(admission.receipt)); return;
    }
    track(broker.submit(value).then(writeRecord));
  };
  const handleLine = (line) => { let text, value; try { text = decoder.decode(line.length && line.at(-1) === 13 ? line.subarray(0, -1) : line); value = JSON.parse(text); } catch { track(writeRecord(safeRefusal(null, "invalid-json-line"))); return; } handleValue(value); };
  const rejectLargeLine = () => track(writeRecord(safeRefusal(null, "line-too-large")));
  const onData = (raw) => {
    let chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw), offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset), end = newline === -1 ? chunk.length : newline, part = chunk.subarray(offset, end);
      if (!discarding) {
        if (buffered + part.length > maxLineBytes) { chunks = []; buffered = 0; discarding = true; rejectLargeLine(); }
        else { if (part.length) chunks.push(part); buffered += part.length; }
      }
      if (newline !== -1) { if (!discarding) handleLine(Buffer.concat(chunks, buffered)); chunks = []; buffered = 0; discarding = false; offset = newline + 1; } else offset = chunk.length;
    }
  };
  const onEnd = () => { if (!discarding && buffered) handleLine(Buffer.concat(chunks, buffered)); chunks = []; buffered = 0; finishInput(); };
  readable.on("data", onData); readable.once("end", onEnd); readable.once("close", finishInput); readable.once("error", finishInput);
  const drain = async () => { while (tasks.size) await Promise.allSettled([...tasks]); await writes.catch(() => {}); };
  const done = inputEnded.then(async () => { await drain(); if (endWritableOnInputEnd && connected()) await new Promise((resolveEnd) => writable.end(resolveEnd)); });
  const stopInput = () => { readable.pause(); finishInput(); };
  const end = async () => { stopInput(); await drain(); if (connected()) await new Promise((resolveEnd) => writable.end(resolveEnd)); };
  return { inputEnded, done, drain, stopInput, end };
}
