import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";
import { transferAuthProfile } from "../../src/authentication/profile-transfer.mjs";

const validNotebook = (value) => Array.isArray(value.cookies) && value.cookies.length > 0;
const validCodex = (value) => typeof value.tokens?.access_token === "string" && value.tokens.access_token.length > 0;

function inTempDirectory(prefix, operation) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try { operation(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("profile transfer preserves rotated cookies and authenticates unchanged seeds", () => inTempDirectory("profile-transfer-", (directory) => {
  const args = { mode: "restore", seed: JSON.stringify({ cookies: [{ name: "cookie", value: "initial" }] }), profilePath: join(directory, "profile.json"), sealedPath: join(directory, "sealed.json"), namespace: "youtube-notebook", validate: validNotebook };
  transferAuthProfile(args);
  writeFileSync(args.profilePath, JSON.stringify({ cookies: [{ name: "cookie", value: "rotated-secret" }] }));
  transferAuthProfile({ ...args, mode: "save" });
  assert.ok(!readFileSync(args.sealedPath, "utf8").includes("rotated-secret"));
  writeFileSync(args.profilePath, "{}");
  transferAuthProfile(args);
  assert.equal(JSON.parse(readFileSync(args.profilePath, "utf8")).cookies[0].value, "rotated-secret");
  assert.throws(() => transferAuthProfile({ ...args, seed: "wrong-key" }));
}));

test("a replacement seed supersedes old state; invalid or tampered input leaves the profile untouched", () => inTempDirectory("profile-transfer-rotate-", (directory) => {
  const args = { mode: "restore", seed: JSON.stringify({ cookies: [{ value: "old-login" }] }), profilePath: join(directory, "profile.json"), sealedPath: join(directory, "sealed.json"), namespace: "youtube-notebook", validate: validNotebook };
  transferAuthProfile(args);
  transferAuthProfile({ ...args, mode: "save" });
  const replacement = { ...args, seed: JSON.stringify({ cookies: [{ value: "new-login" }] }) };
  transferAuthProfile(replacement);
  assert.equal(JSON.parse(readFileSync(args.profilePath, "utf8")).cookies[0].value, "new-login");
  transferAuthProfile({ ...replacement, mode: "save" });
  writeFileSync(args.profilePath, "preserve me");
  const envelope = JSON.parse(readFileSync(args.sealedPath, "utf8"));
  envelope.tag = Buffer.alloc(16).toString("base64");
  writeFileSync(args.sealedPath, JSON.stringify(envelope));
  assert.throws(() => transferAuthProfile(replacement));
  assert.equal(readFileSync(args.profilePath, "utf8"), "preserve me");
  assert.throws(() => transferAuthProfile({ ...replacement, seed: "{}" }));
  assert.equal(readFileSync(args.profilePath, "utf8"), "preserve me");
}));

test("the existing version-one encrypted profile envelope opens with its original key and AAD", () => inTempDirectory("profile-transfer-legacy-", (directory) => {
  const seed = JSON.stringify({ tokens: { access_token: "access", refresh_token: "refresh" } });
  const plaintext = JSON.stringify({ tokens: { access_token: "rotated", refresh_token: "legacy-refresh" } });
  const namespace = "youtube-codex";
  const key = sha256(`${namespace}-auth-v1\0${seed}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${namespace}-auth-v1`));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = { version: 1, iv: iv.toString("base64"), data: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  const sealedPath = join(directory, "legacy.json"), profilePath = join(directory, "auth.json");
  writeFileSync(sealedPath, JSON.stringify(envelope));
  transferAuthProfile({ mode: "restore", seed, profilePath, sealedPath, namespace, validate: validCodex });
  assert.equal(JSON.parse(readFileSync(profilePath, "utf8")).tokens.refresh_token, "legacy-refresh");
}));

test("profile namespaces keep independent encrypted state", () => inTempDirectory("profile-transfer-namespace-", (directory) => {
  const args = { mode: "restore", seed: JSON.stringify({ tokens: { access_token: "initial", refresh_token: "initial-refresh" } }), profilePath: join(directory, "auth.json"), sealedPath: join(directory, "sealed.json"), namespace: "youtube-codex", validate: validCodex };
  transferAuthProfile(args);
  writeFileSync(args.profilePath, JSON.stringify({ tokens: { access_token: "new", refresh_token: "new-refresh" } }));
  transferAuthProfile({ ...args, mode: "save" });
  writeFileSync(args.profilePath, "{}");
  transferAuthProfile(args);
  assert.equal(JSON.parse(readFileSync(args.profilePath, "utf8")).tokens.refresh_token, "new-refresh");
  assert.throws(() => transferAuthProfile({ ...args, namespace: "youtube-notebook", validate: validNotebook }));
}));
