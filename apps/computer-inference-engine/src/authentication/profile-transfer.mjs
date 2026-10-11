import { existsSync, readFileSync } from "node:fs";
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { openSecret, sealSecret } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/seal";
import { writeFileAtomic } from "@red-cup-engineering/computer-system-engine/filesystem";

function validateValue(text, validate, label) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`Invalid ${label} JSON`); }
  if (typeof validate !== "function" || !validate(value)) throw new Error(`Invalid ${label}`);
  return value;
}

/** Transfer an encrypted JSON profile between a runner seed and its profile file. */
export function transferAuthProfile({ mode, seed, profilePath, sealedPath, namespace, validate }) {
  if (!new Set(["restore", "save"]).has(mode)) throw new Error("mode must be restore or save");
  if (typeof seed !== "string" || seed.length === 0) throw new Error("Missing authentication seed");
  if (typeof profilePath !== "string" || !profilePath || typeof sealedPath !== "string" || !sealedPath) throw new Error("profilePath and sealedPath are required");
  if (typeof namespace !== "string" || !/^[a-z0-9][a-z0-9.-]*$/u.test(namespace)) throw new Error("Invalid authentication namespace");
  const seedValue = validateValue(seed, validate, "authentication seed");
  const aad = `${namespace}-auth-v1`;
  const fingerprint = sha256Hex(`${namespace}-auth-seed-v1\0${seed}`);
  const key = sha256(`${aad}\0${seed}`).toString("base64");

  if (mode === "restore") {
    let text = seed;
    if (existsSync(sealedPath)) {
      let envelope;
      try { envelope = JSON.parse(readFileSync(sealedPath, "utf8")); }
      catch { throw new Error("Invalid encrypted authentication state JSON"); }
      if (envelope.version !== 1) throw new Error("Unknown encrypted authentication state version");
      // A changed login seed supersedes old state; an unchanged seed must open it.
      if (!envelope.seedFingerprint || envelope.seedFingerprint === fingerprint) {
        const combined = Buffer.concat([Buffer.from(envelope.data, "base64"), Buffer.from(envelope.tag, "base64")]);
        text = openSecret(`v1.${Buffer.from(envelope.iv, "base64").toString("base64url")}.${combined.toString("base64url")}`, key, { aad });
      }
    }
    const value = validateValue(text, validate, "authentication data");
    writeFileAtomic(profilePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    return value;
  }

  const profileText = readFileSync(profilePath, "utf8");
  validateValue(profileText, validate, "authentication data");
  const parts = sealSecret(profileText, key, { aad }).split(".");
  const combined = Buffer.from(parts[2], "base64url");
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);
  writeFileAtomic(sealedPath, `${JSON.stringify({
    version: 1,
    seedFingerprint: fingerprint,
    iv: Buffer.from(parts[1], "base64url").toString("base64"),
    data: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  }, null, 2)}\n`, { mode: 0o600 });
  return seedValue;
}
