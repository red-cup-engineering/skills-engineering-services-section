#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { knowledgeVaultCockpitManifest, renderCockpitManifestMarkdown } from "../cockpit.mjs";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const markdown = args.includes("--markdown");
  const connectors = args.includes("--connectors");
  const manifest = knowledgeVaultCockpitManifest();
  process.stdout.write(markdown
    ? `${renderCockpitManifestMarkdown(manifest)}\n`
    : connectors
      ? `${JSON.stringify(manifest.connectors, null, 2)}\n`
      : `${JSON.stringify(manifest, null, 2)}\n`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`obsidian-knowledge-cockpit: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
