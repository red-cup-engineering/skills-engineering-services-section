/** Account-scoped no-overage admission for Workers AI.
 * Free allocation and hard stop: https://developers.cloudflare.com/workers-ai/platform/pricing/
 * The private billing-read binding is receiver-owned; it never enters model messages.
 */
export class CloudflareFreeAdmissionError extends Error {
  constructor(reason, status) { super(reason); this.name = "CloudflareFreeAdmissionError"; this.reason = reason; if (Number.isInteger(status)) this.status = status; }
}
export async function admitCloudflareFreeInvocation({ endpoint, env = process.env, fetchImpl = fetch, signal } = {}) {
  const url = new URL(endpoint);
  const match = /^\/client\/v4\/accounts\/([^/]+)\/ai\/v1\/chat\/completions\/?$/u.exec(url.pathname);
  if (url.origin !== "https://api.cloudflare.com" || !match) throw new CloudflareFreeAdmissionError("cloudflare-account-endpoint-not-admitted");
  const key = env.API_KEY_CLOUDFLARE_BILLING_READ;
  if (typeof key !== "string" || !key.length) throw new CloudflareFreeAdmissionError("cloudflare-billing-read-binding-unavailable");
  const account = decodeURIComponent(match[1]);
  const response = await fetchImpl("https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/subscriptions", {
    headers: { authorization: "Bearer " + key }, signal,
  });
  if (!response.ok) throw new CloudflareFreeAdmissionError("cloudflare-account-read-refused", response.status);
  const body = await response.json();
  if (body.success !== true || !Array.isArray(body.result) || body.result.some(row => !row?.rate_plan || typeof row.rate_plan.id !== "string"))
    throw new CloudflareFreeAdmissionError("cloudflare-account-reading-invalid");
  const active = body.result.filter(row => !["Cancelled", "Canceled", "Expired"].includes(row.state));
  if (!active.some(row => row.rate_plan.id === "free")) throw new CloudflareFreeAdmissionError("cloudflare-free-plan-not-observed");
  // R2 and Teams are independent subscriptions. A Workers paid or unidentified
  // Workers plan cannot inherit the account's separate zone Free subscription.
  const workers = active.filter(row => /workers|serverless|unbound|bundled/iu.test(row.rate_plan.id + " " + (row.rate_plan.public_name ?? "")));
  if (workers.some(row => !/(?:^|[ _-])free(?:$|[ _-])/iu.test(row.rate_plan.id + " " + (row.rate_plan.public_name ?? ""))))
    throw new CloudflareFreeAdmissionError("cloudflare-workers-paid-or-unknown-plan");
  return Object.freeze({ provider: "cloudflare-workers-ai", account, cashCost: "zero", paidOverage: "forbidden" });
}
