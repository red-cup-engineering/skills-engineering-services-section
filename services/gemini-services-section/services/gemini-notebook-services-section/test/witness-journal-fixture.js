import { spawn } from "node:child_process";
import { once } from "node:events";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";

const ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";
const PROVIDER = "urn:ame:notebooklm-inference-team";

export async function startGeminiNotebookWitnessJournalFixture() {
  // spawnSync-based contract clients block this process's event loop, so the
  // HTTP provider must own a distinct process rather than merely a new server.
  const providerModule = import.meta.resolve("@red-cup-engineering/witness-journal-document-service/test-provider");
  const program = `
    import { startWitnessJournalProviderProcess } from ${JSON.stringify(providerModule)};
    let provider, agentCardUrl;
    try {
      provider = await startWitnessJournalProviderProcess({ host: "::1" });
      const port = provider.baseUrl.match(/:(\\d+)$/u)?.[1];
      if (!port) throw new Error("WitnessJournal fixture did not report a port");
      agentCardUrl = "http://[::1]:" + port + "/.well-known/agent-card.json";
    } catch {
      if (provider) await provider.close();
      provider = await startWitnessJournalProviderProcess({ host: "localhost" });
      const url = new URL(provider.agentCardUrl); url.hostname = "localhost"; agentCardUrl = url.href;
    }
    process.stdout.write(agentCardUrl + "\\n");
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await provider.close(); process.exit(0); };
    process.on("SIGTERM", close); process.on("SIGINT", close);
  `;
  const provider = spawn(process.execPath, ["--input-type=module", "--eval", program], { stdio: ["ignore", "pipe", "pipe"] });
  const agentCardUrl = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error("WitnessJournal fixture startup timed out")), 5_000);
    let stdout = "", stderr = "";
    provider.stderr.setEncoding("utf8"); provider.stderr.on("data", (chunk) => { stderr += chunk; });
    provider.stdout.setEncoding("utf8"); provider.stdout.on("data", (chunk) => {
      stdout += chunk; const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer); accept(stdout.slice(0, newline));
    });
    provider.once("error", (error) => { clearTimeout(timer); reject(error); });
    provider.once("exit", (code) => { clearTimeout(timer); reject(new Error(`WitnessJournal fixture exited during startup (${code}): ${stderr}`)); });
  });
  return {
    agentCardUrl,
    async record(dataRoot, category, row, recordedAt = "2026-07-19T00:00:00.000Z") {
      const envelope = { type: "GeminiNotebookJobRecord", category, row };
      const graph = semanticId(relationalWitnessJournalDocument(envelope));
      return recordWitnessJournalBatch({ agentUrl: agentCardUrl, batch: {
        settlement: ACCOUNT, graph, recordedAt, document: relationalWitnessJournalDocument(envelope), assertions: [
          { subject: PROVIDER, predicate: "urn:emsenn:gemini-notebook:recorded", object: { kind: "iri", value: graph } },
          { subject: graph, predicate: "urn:emsenn:gemini-notebook:category", object: { kind: "literal", value: category } },
        ],
      } });
    },
    async close() {
      if (provider.exitCode !== null) return;
      provider.kill("SIGTERM");
      await Promise.race([once(provider, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("WitnessJournal fixture shutdown timed out")), 5_000))]);
    },
  };
}
