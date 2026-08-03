#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { checkTy } from "@red-cup-engineering/relation-model-notation-typing";
import { decodeNormalizedCarrier, normalizedCarrierBytes } from "../src/modern-rmn-carrier.mjs";

const message = Message.fromJSON(JSON.parse(readFileSync(0, "utf8")));
if (message.role !== Role.ROLE_USER) throw new Error("RMN conformance requires ROLE_USER");
const input = extractRmnPart(message.parts);
const ascription = decodeNormalizedCarrier(input.bytes);
if (ascription?.[0] !== "ascribe" || ascription.length !== 3 || !checkTy([], ascription[2], ascription[1])) throw new Error("term does not inhabit its declared RMN type");
process.stdout.write(`${JSON.stringify(Message.toJSON({
  messageId: randomUUID(), contextId: message.contextId, taskId: message.taskId,
  role: Role.ROLE_AGENT, parts: [rmnPart(normalizedCarrierBytes(ascription), "normal-form.rmn.cbor")],
  metadata: { disposition: "conformant" }, extensions: [], referenceTaskIds: [],
}))}\n`);
