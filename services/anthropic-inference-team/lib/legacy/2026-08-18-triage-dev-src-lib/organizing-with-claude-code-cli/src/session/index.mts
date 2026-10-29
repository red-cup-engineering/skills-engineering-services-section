// The Claude Code CLI session computer: @emsenn/organizing-with-claude/session
// is the normative workspace/impact/findings substrate for Claude leaves; this
// package adds the five-capability CLI (capsule/finding/impact/recall/trace).
export {
  WsPackageSchema,
  wsPackageCarrier,
  findRepoRoot,
  loadWorkspace,
} from "@emsenn/organizing-with-claude/session";
export type { WsPackage, Workspace } from "@emsenn/organizing-with-claude/session";

export {
  ImpactPackageSchema,
  impactPackageCarrier,
  ChangeImpactSchema,
  changeImpactCarrier,
  computeImpact,
  suggestCommands,
} from "@emsenn/organizing-with-claude/session";
export type { ImpactPackage, ChangeImpact } from "@emsenn/organizing-with-claude/session";

export {
  FindingSchema,
  findingCarrier,
  finding,
  recall,
  recallStatus,
} from "@emsenn/organizing-with-claude/session";
export type { Finding } from "@emsenn/organizing-with-claude/session";

export {
  CliResultSchema,
  CapsuleFileSliceSchema,
  SessionCapsuleSchema,
  TraceSummarySchema,
  cliResultCarrier,
  capsuleFileSliceCarrier,
  sessionCapsuleCarrier,
  traceSummaryCarrier,
  canonicalizeCliResultAction,
  canonicalizeCapsuleFileSliceAction,
  canonicalizeSessionCapsuleAction,
  canonicalizeTraceSummaryAction,
  actions as claudeCodeCliSessionActions,
  runSessionCli,
} from "./session.mjs";
export type { CliResult } from "./session.mjs";
