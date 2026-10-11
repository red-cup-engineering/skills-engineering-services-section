#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImageWithFallback, buildProvenance, DEFAULT_PROVIDERS } from "../../src/image/image-generation.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/**
 * Generate one image from a prompt and write the PNG plus its provenance
 * sidecar JSON to outDir. The effectful wrapper over the pure src algebra
 * -- the shape consumer packages import.
 * @param {string} prompt
 * @param {{outDir:string, fileBaseName:string, targetWidth?:number, providers?:Array<Function>, fetchImpl?:typeof fetch, now?:()=>string}} opts
 * @returns {Promise<{imagePath:string, provenancePath:string, provenance:object}>}
 * @throws {Error} when outDir or fileBaseName is missing, or when every provider fails
 */
export async function generateImage(
  prompt,
  { outDir, fileBaseName, targetWidth, providers = DEFAULT_PROVIDERS, fetchImpl, now = () => new Date().toISOString() }
) {
  if (!outDir) throw new Error("generateImage requires outDir");
  if (!fileBaseName) throw new Error("generateImage requires fileBaseName");

  const generated = await generateImageWithFallback(prompt, { providers, fetchImpl, targetWidth });

  await mkdir(outDir, { recursive: true });
  const imagePath = path.join(outDir, `${fileBaseName}.png`);
  await writeFile(imagePath, generated.buffer);

  const provenance = buildProvenance({
    provider: generated.provider,
    model: generated.model,
    promptUsed: prompt,
    generatedAt: now(),
    sourceWidthPx: generated.sourceWidthPx,
    targetWidthPx: generated.targetWidthPx,
    upscaled: generated.upscaled,
    upscaleNote: generated.upscaleNote,
    outputPath: imagePath,
  });
  const provenancePath = path.join(outDir, `${fileBaseName}.provenance.json`);
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2), "utf8");

  return { imagePath, provenancePath, provenance };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "generate-image", description: "Generate one image from a prompt and write the PNG plus its provenance sidecar JSON to outDir.", operation: generateImage }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
