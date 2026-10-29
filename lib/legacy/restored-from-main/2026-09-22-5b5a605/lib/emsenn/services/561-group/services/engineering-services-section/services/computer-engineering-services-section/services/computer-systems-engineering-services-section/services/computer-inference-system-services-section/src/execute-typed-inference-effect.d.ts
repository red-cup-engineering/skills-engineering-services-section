export type TypedInferenceMode = "dry-run" | "live";

export interface TypedInferenceOperationMarks {
  readonly instruction: string;
  readonly input: string;
  readonly model: string;
  readonly mode: TypedInferenceMode;
}

export interface TypedInferencePerformed {
  readonly disposition: "completion" | "refused";
  readonly text: string;
  readonly usage?: Readonly<Record<string, unknown>>;
  readonly cost?: Readonly<Record<string, unknown>>;
}

export interface TypedInferenceEvidenceContext {
  readonly instruction: string;
  readonly input: string;
  readonly model: string;
  readonly mode: TypedInferenceMode;
  readonly startedAt: number;
  readonly performed: TypedInferencePerformed;
  readonly error: Error | undefined;
}

export interface A2aMessagePart {
  readonly raw?: string;
  readonly text?: string;
  readonly filename?: string;
  readonly mediaType: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface A2aMessage {
  readonly messageId?: string;
  readonly role: "ROLE_USER" | "ROLE_AGENT";
  readonly parts: readonly A2aMessagePart[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type SettlementAccount = string | (() => string);

export interface ExecuteTypedInferenceEffectConfig {
  readonly providerLabel: string;
  readonly settlement: SettlementAccount;
  readonly law?: string;
  readonly operationType?: readonly unknown[];
  readonly performInference: (marks: TypedInferenceOperationMarks) => Promise<TypedInferencePerformed> | TypedInferencePerformed;
  readonly measures: (prior: readonly unknown[] | undefined, performed: TypedInferencePerformed) => unknown[];
  readonly documentExtra?: Readonly<Record<string, unknown>> | ((ctx: { marks: TypedInferenceOperationMarks; performed: TypedInferencePerformed }) => Readonly<Record<string, unknown>>);
  readonly buildExtraEvidence?: (ctx: TypedInferenceEvidenceContext) => (Readonly<Record<string, unknown>> & { id: string }) | undefined;
  readonly evidenceSink?: (record: Readonly<Record<string, unknown>>) => Promise<void> | void;
}

export interface ExecuteTypedInferenceEffectOptions {
  readonly settlement?: SettlementAccount;
  readonly performInference?: ExecuteTypedInferenceEffectConfig["performInference"];
  readonly evidenceSink?: ExecuteTypedInferenceEffectConfig["evidenceSink"];
}

export declare const TYPED_INFERENCE_OPERATION_TYPE: readonly unknown[];

export declare function requiredAgentUrl(name: string): string;

export declare function rawInferencePart(message: A2aMessage, providerLabel: string): A2aMessagePart;

export declare function typedInferenceOperationMarks(term: unknown): TypedInferenceOperationMarks;

export declare function executeTypedInferenceEffect(
  message: A2aMessage,
  config: ExecuteTypedInferenceEffectConfig,
  options?: ExecuteTypedInferenceEffectOptions,
): Promise<A2aMessage & { metadata: Record<string, unknown> }>;
