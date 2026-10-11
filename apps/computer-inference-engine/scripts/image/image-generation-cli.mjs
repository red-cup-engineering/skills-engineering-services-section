#!/usr/bin/env node
import { generateImage } from "./generate-image.mjs";

/** @module image-generation-cli -- composed CLI face over generateImage; apps compose scripts and src. */
async function main() {
  const [prompt, outDir, fileBaseNameArg] = process.argv.slice(2);
  if (!prompt || !outDir) {
    console.error("usage: image-generation-cli <prompt> <outDir> [fileBaseName]");
    process.exitCode = 1;
    return;
  }
  const fileBaseName = fileBaseNameArg ?? `image-${Date.now()}`;
  const { imagePath, provenance } = await generateImage(prompt, { outDir, fileBaseName });
  console.log(`wrote ${imagePath} (provider=${provenance.provider} model=${provenance.model})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
