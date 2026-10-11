import { setTimeout as pause } from "node:timers/promises";
import { exchangeRecorder } from "../command/exchange.mjs";

const ENDPOINT = "https://aihorde.net/api/v2/generate/text/async";
const CLIENT = "FeltOS:0.1:https://github.com/red-cup-engineering/computer-services-section";

/** Native volunteer text inference: one owned asynchronous request, never a proxy completion. */
export async function runHordeTextExchange(packet, { fetchImpl = fetch, signal, timeoutMs = 180000 } = {}) {
  const record = exchangeRecorder(packet, "ai-horde-text-generations");
  const gemma = packet.model === "google/gemma-4-31b";
  if (!gemma && !/^koboldcpp\/Llama-3\.2-(?:1|3)B-Instruct(?:-Q4_K_M)?$/u.test(packet.model)) {
    return record.refusal("this carrier admits only its declared Gemma 4 and Llama 3 instruction templates", ["unsupported-horde-model-template"], 0);
  }
  const headers = { "Content-Type": "application/json", "apikey": "0000000000", "Client-Agent": CLIENT, "User-Agent": "FeltOS/0.1" };
  const lifetime = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const thinking = packet.params?.thinking === true;
  // Match the canonical Gemma 4 generation prefix, including its empty
  // thought channel when thinking is disabled (Google chat_template.jinja).
  const prompt = gemma ? packet.messages.map(message => `<|turn>${message.role === "assistant" ? "model" : message.role}\n${thinking && message.role === "system" ? "<|think|>\n" : ""}${message.content}<turn|>\n`).join("") + `<|turn>model\n<|channel>thought\n${thinking ? "" : "<channel|>"}`
    : "<|begin_of_text|>" + packet.messages.map(message =>
    `<|start_header_id|>${message.role}<|end_header_id|>\n\n${message.content}<|eot_id|>`).join("")
    + "<|start_header_id|>assistant<|end_header_id|>\n\n";
  let ownedRequest;
  try {
    const workers = await fetchImpl("https://aihorde.net/api/v2/workers?type=text", { headers, signal: lifetime }, { purpose: "provider-admission" });
    if (!workers.ok) return record.refusal("AI Horde worker capacity could not be read", ["horde-capacity-unobserved"], 0);
    const available = await workers.json();
    const outputBound = packet["max-tokens"] ?? 256;
    const contexts = Array.isArray(available) ? available.filter(worker => worker.online === true && worker.maintenance_mode !== true
      && worker.models?.includes(packet.model) && Number.isSafeInteger(worker.max_length) && worker.max_length >= outputBound
      && Number.isSafeInteger(worker.max_context_length) && worker.max_context_length > outputBound).map(worker => worker.max_context_length) : [];
    if (!contexts.length) return record.refusal("no observed worker admits the selected model and output allocation", ["horde-capacity-unavailable"], 0);
    const response = await fetchImpl(ENDPOINT, { method: "POST", headers, signal: lifetime,
      body: JSON.stringify({ prompt, models: [packet.model], params: { n: 1,
        // Start at the API's documented context floor, rather than reserving an
        // entire volunteer context window for a short request. Native grow uses
        // the actual tokenized prompt and preserves it rather than cutting it.
        max_context_length: Math.min(Math.max(...contexts), Math.max(2048, outputBound + 1)), max_length: outputBound, temperature: 0.1,
        stop_sequence: gemma ? ["<turn|>"] : ["<|eot_id|>"] }, context_fit: "grow", validated_backends: true }) });
    if (!response.ok) {
      let rc;
      try { const error = await response.json(); if (typeof error.rc === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(error.rc)) rc = error.rc; } catch { /* Status alone is still a refusal. */ }
      return record.refusal(`AI Horde refused the text request (${response.status}${rc ? `, ${rc}` : ""})`, [`horde-http:${response.status}`, ...(rc ? [rc] : [])], 0);
    }
    const admission = await response.json();
    if (typeof admission.id !== "string" || !/^[0-9a-f-]{36}$/iu.test(admission.id)) return record.refusal("AI Horde returned no admitted request id", ["horde-missing-request-id"], 0);
    ownedRequest = admission.id;
    const statusUrl = `https://aihorde.net/api/v2/generate/text/status/${ownedRequest}`;
    for (;;) {
      const status = await fetchImpl(statusUrl, { headers, signal: lifetime }, { purpose: "provider-admission" });
      if (!status.ok) return record.refusal(`AI Horde refused the owned request status (${status.status})`, [`horde-http:${status.status}`]);
      const body = await status.json();
      if (body.faulted === true || body.is_possible === false) return record.refusal("AI Horde cannot fulfill the selected model request", ["horde-generation-unavailable"]);
      if (body.done === true) {
        const generation = body.generations?.[0];
        if (generation?.model !== packet.model || typeof generation.text !== "string" || !generation.text.trim()) {
          return record.refusal("AI Horde returned no text from the selected model", ["horde-invalid-generation"]);
        }
        ownedRequest = undefined;
        // Kudos are queue priority units; they are not token or cash measurements.
        return record.completion({ model: generation.model, text: generation.text.replace(gemma ? /<turn\|>\s*$/u : /<\|eot_id\|>\s*$/u, ""), finishReason: "unknown",
          raw: { requestId: admission.id, generation, kudos: body.kudos ?? null } });
      }
      await pause(2000, undefined, { signal: lifetime });
    }
  } catch {
    return record.refusal(signal?.aborted ? "receiver cancelled its AI Horde request" : lifetime.aborted ? "AI Horde request exceeded its lifetime" : "AI Horde transport failed",
      [signal?.aborted ? "receiver-cancelled" : lifetime.aborted ? "horde-request-timeout" : "horde-transport-failed"]);
  } finally {
    // Delete only this invocation's admitted job, with a separate bounded cleanup lifetime.
    if (ownedRequest) await fetchImpl(`https://aihorde.net/api/v2/generate/text/status/${ownedRequest}`,
      { method: "DELETE", headers, signal: AbortSignal.timeout(5000) }, { purpose: "provider-admission" }).catch(() => {});
  }
}
