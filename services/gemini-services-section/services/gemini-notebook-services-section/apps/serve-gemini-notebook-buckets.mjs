#!/usr/bin/env node
// The Gemini Notebook library as an S3 endpoint on this machine: every notebook
// a bucket, its Studio artifacts and uploaded sources the objects, read live
// with the notebooklm login. Point any S3 client at it, e.g.
//   aws s3 ls --endpoint-url http://127.0.0.1:18849 --no-sign-request s3://
//   rclone lsf :s3,provider=Other,endpoint=http://127.0.0.1:18849: -R
// or open it in a browser for an index. It is read-only, and it binds the
// loopback address by default: whoever reaches it reads the signed-in library.
import process from "node:process";
import { s3Resource } from "@red-cup-engineering/http-services-section/s3";
import { startWebServer } from "@red-cup-engineering/http-services-section/node-server";
import { createWebServer } from "@red-cup-engineering/http-services-section/web-application";
import { createGeminiNotebookBuckets } from "../src/gemini-notebook-buckets.mjs";

const host = process.env.GEMINI_NOTEBOOK_BUCKETS_HOST ?? "127.0.0.1";
const port = Number(process.env.GEMINI_NOTEBOOK_BUCKETS_PORT ?? 18849);
const resource = s3Resource(await createGeminiNotebookBuckets(), { title: "Gemini Notebook" });
await startWebServer(createWebServer({ resources: [resource] }), { host, port });
process.stdout.write(`${JSON.stringify({ serving: "gemini-notebook-buckets", url: `http://${host}:${port}/`})}\n`);
