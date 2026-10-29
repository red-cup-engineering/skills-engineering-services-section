import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [entryPackageDirectory, outputDirectory, materializerModule, sourceCatalogModule] = process.argv.slice(2);
if (![entryPackageDirectory, outputDirectory, materializerModule, sourceCatalogModule].every((value) => typeof value === "string" && value.length > 0)) {
  throw new TypeError("usage: materialize-context ENTRY OUTPUT MATERIALIZER_MODULE SOURCE_CATALOG_MODULE");
}

// The source catalog and the release materializer are the producer and the
// consumer of one NodePackageSourceCatalogReceipt v1 contract, so both come
// from node-runtime-release-materialization-service.
const { materializeNodeRuntimeRelease, verifyNodeRuntimeRelease } = await import(materializerModule);
const { catalogNodePackageSources } = await import(sourceCatalogModule);
const sourceCatalog = await catalogNodePackageSources({ entryPackageDirectory });
const releases = `${resolve(outputDirectory)}.releases`;
const receipt = await materializeNodeRuntimeRelease({ entryPackageDirectory, sourceCatalog, outputRoot: releases });
const verification = await verifyNodeRuntimeRelease(receipt.releaseDirectory);
if (!verification.ok) throw new Error(`fabricated runtime release did not verify: ${JSON.stringify(verification)}`);
await mkdir(outputDirectory, { recursive: false });
await cp(`${receipt.releaseDirectory}/app`, `${resolve(outputDirectory)}/app`, { recursive: true, errorOnExist: true });
await cp(`${receipt.releaseDirectory}/release-receipt.json`, `${resolve(outputDirectory)}/release-receipt.json`, { errorOnExist: true });
await writeFile(`${resolve(outputDirectory)}/source-catalog-receipt.json`, `${JSON.stringify(sourceCatalog, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ receipt, verification, sourceCatalog: sourceCatalog.id }, null, 2)}\n`);
