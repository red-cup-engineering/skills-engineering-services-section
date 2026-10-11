#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { AGENT_CARD_PATH } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { loadSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { deliverActivity } from "@red-cup-engineering/activitypub-services-section";
import { createActivityPubR2Custody } from "@red-cup-engineering/activitypub-server/r2-custody";
import { serveActivityPubProvider } from "@red-cup-engineering/activitypub-server";
import { extractSenActivity, projectSenActivity } from "@red-cup-engineering/activitypub-services-section/sen-activity";
import { extractSenPart, parseA2aMessage } from "@red-cup-engineering/a2a-services-section/sen-part";
import { executeGeminiNotebookA2aMessage } from "./a2a-executor.mjs";
import { createGeminiNotebookActivityPubR2Queue } from "./activitypub-r2-custody.mjs";

export async function signedGeminiNotebookAgentCard(options = {}) {
  return loadSignedAgentCard({
    origin: options.origin,
    cardPath: options.cardPath ?? resolve(import.meta.dirname, "../content/agent-cards/notebooklm-inference-team.json"),
    signingKeyPath: options.signingKeyPath,
    jwksPath: options.jwksPath,
    kid: options.kid,
    algorithm: options.algorithm,
  });
}

export async function serveGeminiNotebookActivityPub(options = {}) {
  const origin = (options.origin ?? process.env.ACTIVITYPUB_ORIGIN ?? "").replace(/\/$/u, "");
  if (!origin) throw new Error("ACTIVITYPUB_ORIGIN is required");
  const identifier = options.identifier ?? process.env.ACTIVITYPUB_IDENTIFIER ?? "notebooklm-inference-team";
  const actor = `${origin}/actors/${identifier}`;
  // activitypub-services-section's createActivityPubR2Custody covers kv+inbox only (R2 has no
  // atomic dequeue); the queue capability it deliberately omits is composed in from the
  // gemini-notebook-specific R2 queue, unchanged from what this file used to hand-roll.
  const custody = options.custody ?? {
    ...createActivityPubR2Custody({ actor: identifier }),
    queue: createGeminiNotebookActivityPubR2Queue({ actor: identifier }),
  };
  const discovery = options.agentCardDocuments ?? await signedGeminiNotebookAgentCard({ origin, ...options.agentCardSigning });
  const fetchActor = options.fetch ?? fetch;
  let running;

  async function receive(arrival) {
    const activity = arrival?.jsonLd;
    const sender = typeof activity?.actor === "string" ? activity.actor : null;
    if (!sender || sender === actor) return;
    const projection = extractSenActivity(activity, { expectedActor: sender, expectedRecipient: actor });
    const responseMessage = await (options.execute ?? executeGeminiNotebookA2aMessage)(projection.a2aMessage, options.executorOptions);
    const bytes = extractSenPart(parseA2aMessage(responseMessage).parts).bytes;
    const response = projectSenActivity({
      type: "Accept",
      origin,
      identifier,
      recipient: sender,
      objectBytes: bytes,
      a2aMessage: responseMessage,
      a2aRole: "ROLE_AGENT",
      agentCard: actor,
      eventTime: new Date().toISOString(),
    });
    const actorResponse = await fetchActor(sender, { headers: { accept: "application/activity+json" } });
    if (!actorResponse.ok) throw new Error(`ActivityPub sender actor lookup failed with ${actorResponse.status}`);
    const senderDocument = await actorResponse.json();
    const inbox = typeof senderDocument?.inbox === "string" ? senderDocument.inbox : senderDocument?.inbox?.id;
    if (typeof inbox !== "string" || !inbox) throw new Error("ActivityPub sender actor exposes no inbox");
    await (options.deliver ?? deliverActivity)(running.provider, { activity: response, recipient: sender, inbox });
  }

  running = await (options.serve ?? serveActivityPubProvider)({
    origin,
    identifier,
    actorName: "NotebookLM Inference Team",
    summary: "Executes source-grounded Gemini Notebook library reads through ActivityPub-carried A2A SEN operations.",
    keyPath: options.keyPath ?? process.env.ACTIVITYPUB_KEYS_PATH,
    kv: custody.kv,
    inbox: custody.inbox,
    queue: custody.queue,
    hostname: options.hostname ?? process.env.HOST ?? "0.0.0.0",
    port: Number(options.port ?? process.env.PORT ?? "8080"),
    bearerToken: options.bearerToken ?? randomBytes(32).toString("base64url"),
    onActivity: receive,
    listOutbox: async () => ({ items: [] }),
    wellKnownResources: {
      [`/${AGENT_CARD_PATH}`]: discovery.card,
      "/.well-known/jwks.json": discovery.jwks,
    },
  });
  void running.provider.federation.startQueue(undefined).catch((error) => {
    process.stderr.write(`ActivityPub queue worker stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  });
  return running;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  serveGeminiNotebookActivityPub().then(() => {
    const origin = (process.env.ACTIVITYPUB_ORIGIN ?? "").replace(/\/$/u, "");
    const identifier = process.env.ACTIVITYPUB_IDENTIFIER ?? "notebooklm-inference-team";
    process.stdout.write(`${origin}/actors/${identifier}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
