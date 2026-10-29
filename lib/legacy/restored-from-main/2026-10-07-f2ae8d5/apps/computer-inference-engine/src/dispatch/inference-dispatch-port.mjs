/** Native configured-customer market port; protocol faces preserve these same purchase checks. */
import { configuredInferenceCustomer,
  invokeInspectInferenceResources, invokeDispatchInference, invokeClassifyInferenceDemand,
  invokeRecordInferenceOutcome } from "./inference-dispatch-mcp-contract.mjs";
import { observeProviderModelCatalogs } from "./provider-model-catalog.mjs";

export function inferenceDispatchPort({ environment = process.env, dataRoot, taskStore, dispatch } = {}) {
  const hostEnvironment = Object.freeze({ ...environment });
  const customer = configuredInferenceCustomer(hostEnvironment);
  const ports = Object.freeze({ environment: hostEnvironment });
  // A native host already owns its market and data binding. Only an explicitly
  // named remote task owner crosses the signed network boundary.
  let nativeTasks;
  const tasks = () => {
    if (hostEnvironment.INFERENCE_WORK_LOT_AGENT || (!taskStore && typeof dataRoot !== "string")) return undefined;
    return nativeTasks ??= (async () => {
      const [{ createNativeInferenceTasks }, { DurableA2aTaskStore }, { createFilesystemA2aTaskSource }, { join }] = await Promise.all([
        import("./native-inference-tasks.mjs"),
        import("@red-cup-engineering/a2a-services-section/durable-task-store"),
        import("@red-cup-engineering/a2a-services-section/filesystem-state-sources"),
        import("node:path"),
      ]);
      const store = taskStore ?? new DurableA2aTaskStore(createFilesystemA2aTaskSource(join(dataRoot, "inference-work-lot", "a2a-tasks")), { tenant: customer });
      const contract = dispatch ?? (async (request, options) => {
        const { dispatchInferenceAsConfiguredCustomer } = await import("./inference-dispatch.mjs");
        return dispatchInferenceAsConfiguredCustomer(request, { ...options, environment: hostEnvironment, customerActor: customer });
      });
      return createNativeInferenceTasks({ taskStore: store, customer, dispatch: contract });
    })();
  };
  const call = async (name, args) => {
    if (name === "inspect_inference_resources") return invokeInspectInferenceResources(args, { environment: hostEnvironment, observeCatalogs: observeProviderModelCatalogs });
    if (name === "dispatch_inference") return invokeDispatchInference(args, ports);
    if (name === "submit_inference" || name === "receive_inference") {
      const task = await import("./inference-task-operations.mjs");
      const taskPorts = { ...ports, nativeTasks: await tasks() };
      return name === "submit_inference" ? task.invokeSubmitInference(args, taskPorts) : task.invokeReceiveInference(args, taskPorts);
    }
    if (name === "classify_inference_demand") return invokeClassifyInferenceDemand(args);
    if (name === "record_inference_outcome") return invokeRecordInferenceOutcome(args, ports);
    throw new Error(`unknown inference-dispatch operation ${name}`);
  };
  return Object.freeze({ customer, call, tasks });
}

