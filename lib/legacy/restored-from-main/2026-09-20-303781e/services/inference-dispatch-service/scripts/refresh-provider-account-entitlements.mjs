#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGoogleApiRequest } from "@red-cup-engineering/gcloud-runtime-authorities-service";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { runMain } from "@red-cup-engineering/javascript-file-main-guard-service";
import { loadDirectEndpointProviderDescriptors } from "../src/direct-endpoint-provider.mjs";
import { refreshProviderAccountEntitlement } from "../src/provider-account-entitlement.mjs";

/** Refreshes private proof with workload ADC or an explicitly selected local gcloud account.
 * @param {Array<string>} argv Operator arguments.
 * @returns {Promise<object>} A credential-free refresh receipt.
 */
export async function main(argv = process.argv.slice(2)) {
  const provider = argument("--provider", argv);
  const destination = argument("--output", argv) ?? process.env.DIRECT_ENDPOINT_ACCOUNT_ENTITLEMENTS;
  const account = argument("--gcloud-account", argv);
  if (!provider || !destination) throw new TypeError("--provider and --output (or DIRECT_ENDPOINT_ACCOUNT_ENTITLEMENTS) are required");
  const descriptor = loadDirectEndpointProviderDescriptors(process.env).find(value => value.provider === provider);
  if (!descriptor) throw new Error("configured provider descriptor not found");
  const request = createGoogleApiRequest(account ? { accessToken: async () => {
    try {
      const { stdout } = await promisify(execFile)("gcloud", ["auth", "print-access-token", "--account", account], { encoding: "utf8", maxBuffer: 65536 });
      return stdout.trim();
    } catch { throw new Error("selected local Google account authorization unavailable"); }
  } } : {});
  return refreshProviderAccountEntitlement({ descriptor, destination }, { request });
}

await runMain(({ argv }) => main(argv), {
  moduleUrl: import.meta.url,
  formatResult: (result) => JSON.stringify(result) + "\n",
  formatError: () => "Provider account entitlement refresh failed; no credential material was emitted.\n",
  exitCode: 1,
});
