/**
 * What one unit of a resource a carrier consumed costs the house, in money: the seam crossings and
 * the acceptance readout value consumption through (organizing `resources`: {resource, unit, amount,
 * carrier}). Inside the entity price is cost, and a carrier's cost is
 *
 *   zero-cash     the zero-cash pool's model costs nothing: "0", because `zero-cash`;
 *   list          a metered model costs its cited list price per token: because `list:<source>`;
 *   perishable    a subscription's model (one a subscription in content/allowances `carries`) costs
 *                 its opportunity cost: the cited list price of the same model times the
 *                 subscription's perishable price at that instant (organizing `perishablePrice`):
 *                 capacity its window would lapse anyway costs nearly nothing, a window that will be
 *                 spent anyway costs what buying the displaced work would: because
 *                 `perishable:<pool>@<window reset>`;
 *   unknown       anything else, a model with no cited price included, is undefined, never zero.
 *
 * What a delivery also measures but is not charged for prices at nothing where its carrier is
 * priced: requests and duration, since the prices are per token (`not-a-cost-driver`), and total
 * tokens, the sum of the kinds priced on their own (`counted-in-parts`).
 *
 * Prices are per unit (one token), as decimal text in USD. The cited price list is the inference
 * expense ledger's (`data/records/*-inference-price-list.json` of its section).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perishablePrice } from "@red-cup-engineering/organizing/enterprise";
import { allowanceLedgerPath, readAllowanceLedger } from "./allowance-ledger.mjs";
import { subscriptionAllowance } from "./subscription-allowances.mjs";
import { BOUNDED_INFERENCE_SERVICE_MODEL } from "../dispatch/inference-work-lot-source.mjs";

const RECORDS = fileURLToPath(new URL("../../../../services/inference-expense-ledger-services-section/data/records/", import.meta.url));
const ALLOWANCES = fileURLToPath(new URL("../../content/allowances/", import.meta.url));

/** The token resources a price list prices, and the field that prices each. */
const TOKEN_FIELDS = Object.freeze({
  "input-tokens": "inputUsdPerMillionTokens",
  "cached-input-tokens": "cacheReadUsdPerMillionTokens",
  "cache-write-input-tokens": "cacheWriteUsdPerMillionTokens",
  "output-tokens": "outputUsdPerMillionTokens",
  "reasoning-output-tokens": "outputUsdPerMillionTokens",
});

/** The latest cited price list: its entries by model. */
export function citedPriceList(directory = RECORDS) {
  if (!existsSync(directory)) return new Map();
  const latest = readdirSync(directory).filter((name) => /^\d{4}-\d{2}-\d{2}-inference-price-list\.json$/u.test(name)).sort().at(-1);
  if (latest === undefined) return new Map();
  const list = JSON.parse(readFileSync(join(directory, latest), "utf8"));
  return new Map((list.prices ?? []).map((entry) => [entry.model, entry]));
}

/** The subscriptions declared here, each with the model prefixes it carries. */
function subscriptions() {
  return readdirSync(ALLOWANCES).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(ALLOWANCES, name), "utf8"))).filter((declaration) => Array.isArray(declaration.carries));
}

/** Measures a delivery carries that are not charged on their own: their price wherever the carrier is priced. */
const UNCHARGED = Object.freeze({ "requests": "not-a-cost-driver", "duration": "not-a-cost-driver", "total-tokens": "counted-in-parts" });

/** The decimal text of a non-negative number of dollars, without exponent. */
const decimal = (value) => value.toFixed(15).replace(/\.?0+$/u, "") || "0";

/**
 * The cost of one unit of `resource` (`{resource, unit, carrier}`) at `at`, or undefined when no
 * cited price or zero-cash pool answers for it. `perishableOf(pool)` reads a subscription's
 * perishable price; it defaults to the host-wide allowance ledger.
 */
export function resourcePriceOf(resource, { at = new Date().toISOString(), storePath = allowanceLedgerPath(), priceList = citedPriceList(), perishableOf } = {}) {
  const carrier = resource?.carrier;
  if (typeof carrier !== "string" || carrier === "") return undefined;
  if (carrier === BOUNDED_INFERENCE_SERVICE_MODEL) return Object.freeze({ amount: "0", currency: "USD", basis: "cost", because: UNCHARGED[resource.resource] ?? "zero-cash" });
  const cited = priceList.get(carrier);
  if (cited !== undefined && Object.hasOwn(UNCHARGED, resource.resource)) return Object.freeze({ amount: "0", currency: "USD", basis: "cost", because: UNCHARGED[resource.resource] });
  const field = resource.unit === "token" ? TOKEN_FIELDS[resource.resource] : undefined;
  if (field === undefined || cited === undefined || typeof cited[field] !== "string") return undefined;
  const list = Number(cited[field]) / 1_000_000;
  const pool = subscriptions().find((declaration) => declaration.carries.some((prefix) => carrier.startsWith(prefix)));
  if (pool === undefined) return Object.freeze({ amount: decimal(list), currency: "USD", basis: "cost", because: `list:${cited.sourceUrl}` });
  const share = (perishableOf ?? ((id) => perishablePrice(readAllowanceLedger(subscriptionAllowance(id), { storePath, now: at }).reading)))(pool.id);
  if (!Number.isFinite(share.price)) return Object.freeze({ amount: decimal(list), currency: "USD", basis: "cost", because: `perishable:${pool.id}@spent-until-${share.until}` });
  return Object.freeze({ amount: decimal(list * share.price), currency: "USD", basis: "cost", because: `perishable:${pool.id}@${share.until ?? "unread"}` });
}

/** Where the node keeps the prices hot readers read: its allowance records. */
export const resourcePricesPath = (environment = process.env) => environment.METROPLAT_WEB_DATA_DIR
  ? join(environment.METROPLAT_WEB_DATA_DIR, "records", "allowances", "resource-prices.json") : undefined;

/**
 * Every price this host can state now, keyed `<carrier>|<resource>` as outcomes and proposals name
 * them (the model id): the zero-cash pool's and each cited model's token resources. Written whole,
 * atomically, for the readers that value consumption on a hot path.
 */
export function writeResourcePrices({ path = resourcePricesPath(), at = new Date().toISOString(), storePath = allowanceLedgerPath() } = {}) {
  if (typeof path !== "string") throw new TypeError("resource prices need METROPLAT_WEB_DATA_DIR or a path");
  const priceList = citedPriceList();
  const held = new Map();
  const perishableOf = (id) => { if (!held.has(id)) held.set(id, perishablePrice(readAllowanceLedger(subscriptionAllowance(id), { storePath, now: at }).reading)); return held.get(id); };
  const prices = {};
  for (const carrier of [BOUNDED_INFERENCE_SERVICE_MODEL, ...priceList.keys()]) {
    for (const [resource, unit] of [...Object.keys(TOKEN_FIELDS).map((name) => [name, "token"]), ["total-tokens", "token"], ["requests", "request"], ["duration", "millisecond"]]) {
      const price = resourcePriceOf({ resource, unit, carrier }, { at, storePath, priceList, perishableOf });
      if (price !== undefined) prices[`${carrier}|${resource}`] = price;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ kind: "computer-inference-engine.resource-prices", at, currency: "USD", unit: "one unit of the resource", prices }, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}
