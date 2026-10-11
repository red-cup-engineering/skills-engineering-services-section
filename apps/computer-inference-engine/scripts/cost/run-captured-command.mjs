#!/usr/bin/env node
import { argument, requiredArgument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { captureCommand, readCapturedOutput, renderCapturedOutput } from "../../src/cost/tool-output-capture.mjs";

if (process.argv[2] === "--read") {
  const stream = argument("--stream");
  const offset = Number(argument("--offset") ?? 0);
  const maximumBytes = Number(argument("--maximum-bytes") ?? 8192);
  const page = readCapturedOutput({ digest: process.argv[3], stream, offset, maximumBytes });
  process.stdout.write(Buffer.from(page.content, "base64"));
  process.exit(0);
}

const request = JSON.parse(Buffer.from(requiredArgument("--request"), "base64url"));
const capture = await captureCommand(request);
const rendered = renderCapturedOutput(capture, request);
if (rendered.stdout) process.stdout.write(rendered.stdout);
if (rendered.stderr) process.stderr.write(rendered.stderr);
process.exitCode = Number.isInteger(capture.exitCode) ? capture.exitCode : 1;
