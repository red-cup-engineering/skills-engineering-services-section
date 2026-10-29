import { HTTPFacilitatorClient } from "@x402/core/server";
import { createCdpJwt } from "./cdp-jwt.mjs";

// The installed @red-cup-engineering/x402-services-section@1.3.3 "./server"
// export (src/resource-server.mjs) is a thin wrapper over the official
// @x402/core HTTPFacilitatorClient; it does not export a CDP-specific
// constant or factory. The CDP facilitator base URL and its authenticated
// client are therefore owned here, exactly as the working paid-ephemeris-
// gateway product owns them in its own src/cdp-facilitator.mjs.
export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

const CORRELATION_CONTEXT = "sdkLanguage=javascript,source=metered-inference-tollbooth,sourceVersion=2.0.4";

function canonicalBaseUrl(value = CDP_FACILITATOR_URL) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new TypeError("CDP facilitator baseUrl must be one canonical HTTPS URL");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("CDP facilitator baseUrl must be one canonical HTTPS URL");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || /\/\//u.test(url.pathname)
    || /%(?:2f|5c)/iu.test(url.pathname)
  ) {
    throw new TypeError("CDP facilitator baseUrl must be one canonical HTTPS URL without credentials, query, fragment, or ambiguous path separators");
  }
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  if (pathname === "") throw new TypeError("CDP facilitator baseUrl must include its API base path");
  url.pathname = pathname;
  return Object.freeze({
    url: url.href.replace(/\/$/u, ""),
    host: url.host,
    pathname,
  });
}

function credentials(args = {}) {
  const apiKeyId = args.apiKeyId ?? process.env.CDP_API_KEY_ID;
  const apiKeySecret = args.apiKeySecret ?? process.env.CDP_API_KEY_SECRET;
  const missing = [
    ...(apiKeyId ? [] : ["CDP_API_KEY_ID"]),
    ...(apiKeySecret ? [] : ["CDP_API_KEY_SECRET"]),
  ];
  if (missing.length > 0) throw new Error(`Missing required CDP credentials: ${missing.join(", ")}`);
  return Object.freeze({ apiKeyId, apiKeySecret });
}

/** Create the native authenticated Coinbase facilitator client. */
export function createCdpFacilitatorContract(args = {}) {
  const selectedCredentials = credentials(args);
  const base = canonicalBaseUrl(args.baseUrl);
  const endpoint = (operation) => `${base.pathname}/${operation}`;
  return new HTTPFacilitatorClient({
    url: base.url,
    createAuthHeaders: async () => Object.fromEntries(
      [["verify", "POST"], ["settle", "POST"], ["supported", "GET"]].map(([operation, method]) => [operation, {
        Authorization: `Bearer ${createCdpJwt({
          ...selectedCredentials,
          method,
          host: base.host,
          path: endpoint(operation),
        })}`,
        "Correlation-Context": CORRELATION_CONTEXT,
      }]),
    ),
  });
}
