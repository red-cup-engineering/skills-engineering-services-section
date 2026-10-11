/** Native configured-customer market port; protocol faces preserve these same purchase checks. */
import { configuredInferenceCustomer,
  invokeInspectInferenceResources, invokeDispatchInference, invokeClassifyInferenceDemand,
  invokeRecordInferenceOutcome } from "./inference-dispatch-mcp-contract.mjs";
import { observeProviderModelCatalogs } from "./provider-model-catalog.mjs";

export function inferenceDispatchPort({ environment = process.env } = {}) {
  const hostEnvironment = Object.freeze({ ...environment });
  const customer = configuredInferenceCustomer(hostEnvironment);
  const ports = Object.freeze({ environment: hostEnvironment });
  const call = (name, args) => {
    if (name === "inspect_inference_resources") return invokeInspectInferenceResources(args, { environment: hostEnvironment, observeCatalogs: observeProviderModelCatalogs });
    if (name === "dispatch_inference") return invokeDispatchInference(args, ports);
    if (name === "classify_inference_demand") return invokeClassifyInferenceDemand(args);
    if (name === "record_inference_outcome") return invokeRecordInferenceOutcome(args, ports);
    throw new Error(`unknown inference-dispatch operation ${name}`);
  };
  return Object.freeze({ customer, call });
}

