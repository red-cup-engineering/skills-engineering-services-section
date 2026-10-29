// LLM-agent data mount substrate.
//
// Provider packages should inherit mount records through this LLM-agent package
// so the package chain remains organizing-with-agents -> organizing-with-llm-agents
// -> provider.
export {
  DatePartitionSchema,
  datePartitionCarrier,
  MountRecordSchema,
  mountRecordCarrier,
  dataMountRoot,
  datePartition,
  logPath,
  statePath,
  recordPath,
  appendLog,
  readLog,
  writeState,
  readState,
  cutRecord,
} from "@emsenn/organizing-with-agents/mount";

export type {
  DatePartition,
  MountRecord,
  JsonValue,
  LogFold,
} from "@emsenn/organizing-with-agents/mount";
