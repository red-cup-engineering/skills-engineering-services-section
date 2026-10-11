import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  callCloudflareWorkersAIImage,
  normalizeToPng,
  generateImageWithFallback,
  buildProvenance,
} from "../../src/image/image-generation.mjs";
import { generateImage } from "../../scripts/image/generate-image.mjs";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("callCloudflareWorkersAIImage decodes the worker's {imageBase64} response", async () => {
  let capturedUrl, capturedBody;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: "@cf/black-forest-labs/flux-1-schnell", imageBase64: TINY_PNG_BASE64, mimeType: "image/jpeg" }),
    };
  };
  const result = await callCloudflareWorkersAIImage("a prompt", { fetchImpl, workerUrl: "https://example.test/worker" });
  assert.equal(result.provider, "cloudflare-workers-ai");
  assert.equal(result.model, "@cf/black-forest-labs/flux-1-schnell");
  assert.equal(result.base64, TINY_PNG_BASE64);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(capturedUrl, "https://example.test/worker");
  assert.equal(capturedBody.prompt, "a prompt");
});

test("callCloudflareWorkersAIImage needs no api key and throws cleanly on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "worker overloaded" });
  await assert.rejects(
    () => callCloudflareWorkersAIImage("x", { fetchImpl, workerUrl: "https://example.test/worker" }),
    /cloudflare workers ai request failed: HTTP 503/
  );
});

test("callCloudflareWorkersAIImage rejects a response with no imageBase64", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(
    () => callCloudflareWorkersAIImage("x", { fetchImpl, workerUrl: "https://example.test/worker" }),
    /carried no imageBase64/
  );
});

test("normalizeToPng upscales a source below target width with lanczos3", async () => {
  const raw = Buffer.from(TINY_PNG_BASE64, "base64");
  const { buffer, upscaled, sourceWidth, targetWidth } = await normalizeToPng(raw, 64);
  assert.equal(upscaled, true);
  assert.equal(sourceWidth, 1);
  assert.equal(targetWidth, 64);
  assert.ok(buffer.length > 0);
});

test("normalizeToPng leaves a source already at or above target width alone", async () => {
  const raw = Buffer.from(TINY_PNG_BASE64, "base64");
  const { upscaled, reason, sourceWidth } = await normalizeToPng(raw, 1);
  assert.equal(upscaled, false);
  assert.equal(sourceWidth, 1);
  assert.match(reason, /already >= target width/);
});

test("generateImageWithFallback tries Cloudflare Workers AI first by default", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: "@cf/black-forest-labs/flux-1-schnell", imageBase64: TINY_PNG_BASE64, mimeType: "image/jpeg" }),
  });
  const result = await generateImageWithFallback("a prompt", { fetchImpl, targetWidth: 64 });
  assert.equal(result.provider, "cloudflare-workers-ai");
  assert.equal(result.upscaled, true);
});

test("generateImageWithFallback falls back to the next provider on failure", async () => {
  async function simulatedFailingProvider() {
    throw new Error("simulated provider outage");
  }
  async function simulatedSucceedingProvider() {
    return { provider: "test-provider", model: "test-model", base64: TINY_PNG_BASE64, mimeType: "image/png" };
  }
  const result = await generateImageWithFallback("a prompt", {
    providers: [simulatedFailingProvider, simulatedSucceedingProvider],
    targetWidth: 64,
  });
  assert.equal(result.provider, "test-provider");
  assert.equal(result.model, "test-model");
  assert.equal(result.upscaled, true);
});

test("generateImageWithFallback throws an aggregated error when every provider fails", async () => {
  const alwaysFails = async () => {
    throw new Error("nope");
  };
  await assert.rejects(() => generateImageWithFallback("a prompt", { providers: [alwaysFails] }), /all image providers failed/);
});

test("buildProvenance produces the sidecar shape with null defaults", () => {
  const provenance = buildProvenance({
    provider: "test-provider",
    model: "test-model",
    promptUsed: "a prompt",
    generatedAt: "2026-08-31T00:00:00.000Z",
    sourceWidthPx: undefined,
    targetWidthPx: 2400,
    upscaled: true,
    upscaleNote: undefined,
    outputPath: "/tmp/x.png",
  });
  assert.deepEqual(provenance, {
    provider: "test-provider",
    model: "test-model",
    promptUsed: "a prompt",
    generatedAt: "2026-08-31T00:00:00.000Z",
    sourceWidthPx: null,
    outputTargetWidthPx: 2400,
    upscaled: true,
    upscaleNote: null,
    outputPath: "/tmp/x.png",
  });
});

test("generateImage writes the PNG and provenance sidecar, and upscales", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "image-gen-"));
  try {
    async function simulatedFailingProvider() {
      throw new Error("simulated provider outage");
    }
    async function simulatedSucceedingProvider() {
      return { provider: "test-provider", model: "test-model", base64: TINY_PNG_BASE64, mimeType: "image/png" };
    }

    const { imagePath, provenancePath, provenance } = await generateImage("a prompt", {
      outDir: dir,
      fileBaseName: "test-image",
      targetWidth: 64,
      providers: [simulatedFailingProvider, simulatedSucceedingProvider],
    });

    assert.equal(imagePath, path.join(dir, "test-image.png"));
    const imageBytes = await readFile(imagePath);
    assert.ok(imageBytes.length > 0);

    assert.equal(provenance.provider, "test-provider");
    assert.equal(provenance.model, "test-model");
    assert.equal(provenance.upscaled, true);
    assert.equal(provenance.promptUsed, "a prompt");

    const writtenProvenance = JSON.parse(await readFile(provenancePath, "utf8"));
    assert.deepEqual(writtenProvenance, provenance);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateImage throws an aggregated error when every provider fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "image-gen-"));
  try {
    const alwaysFails = async () => {
      throw new Error("nope");
    };
    await assert.rejects(
      () => generateImage("a prompt", { outDir: dir, fileBaseName: "x", providers: [alwaysFails] }),
      /all image providers failed/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateImage requires outDir and fileBaseName", async () => {
  await assert.rejects(() => generateImage("a prompt", { fileBaseName: "x" }), /requires outDir/);
  await assert.rejects(() => generateImage("a prompt", { outDir: "/tmp/whatever" }), /requires fileBaseName/);
});


test("default image failure does not call an implicit paid fallback", async () => {
  const urls = [];
  await assert.rejects(() => generateImageWithFallback("test prompt", {
    fetchImpl: async url => { urls.push(url); return { ok: false, status: 429, text: async () => "allocation exhausted" }; },
  }), /all image providers failed/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /workers\.dev/);
});
