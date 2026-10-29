export type InferenceWorkLotRequest = Readonly<{
  objective: string;
  /** One standard chat-completion turn; its shared JSON Schema owns admission.
   * Tool declarations request model output and grant no execution authority. */
  chatCompletion?: Readonly<Record<string, unknown>>;
  context?: string;
  contextPacket?: Readonly<Record<string, unknown>>;
  desiredUse?: string;
  workType?: "chat" | "classification" | "extraction" | "summarization" | "inquiry" | "software-engineering" | "code-review";
  requiredCapabilities?: readonly string[];
  difficulty?: number;
  taskClass?: string;
  zeroCashOnly?: boolean;
  workPlacement?: Readonly<{
    evaluatedAt?: string;
    accountIdentity?: string;
    windowIdentity?: string;
    requiredImplementationIdentity?: string;
    unknownAvailability?: "permit" | "refuse";
    resourceCeilings?: readonly WorkPlacementResourceDimension[];
    availabilityEvidence?: readonly Readonly<{
      providerIdentity: string;
      accountIdentity: string;
      windowIdentity: string;
      observedAt: string;
      validFrom?: string;
      validUntil?: string;
      resetsAt?: string;
      availableResources: readonly WorkPlacementResourceDimension[];
    }>[];
    observations?: readonly Readonly<Record<string, unknown>>[];
    networkBytes?: number;
  }>;
  agentBounds?: Readonly<{ maximumRequests?: number; maximumToolCalls?: number; maximumOutputTokens?: number; maximumDepth?: number; maximumTokensPerRequest?: number; maximumToolRounds?: number }>;
  outputSchema?: Readonly<Record<string, unknown>>;
  outputProjection?: Readonly<Record<string, unknown>>;
  enforceProviderSchema?: boolean;
  excludeProviders?: readonly string[];
  customer?: string;
  workLotId?: string;
  mode?: "dry-run" | "live";
  considerationPolicy?: Readonly<Record<string, unknown>>;
  routingProfile?: "bounded" | "extended";
  extendedRoutingRationale?: string;
  energyProvenance?: Readonly<Record<string, unknown>>;
}>;

export type WorkPlacementResourceDimension = Readonly<{
  resource: string;
  asset?: string;
  unit: string;
  amount: Readonly<{ numerator: string; denominator: string }>;
}>;

export type InferenceWorkLotExchange = Readonly<{
  result: Readonly<Record<string, unknown>>;
  resultNi: string;
  provider: Readonly<{ account: string; [key: string]: unknown }>;
  exchange: Readonly<{ inputNi: string; outputNi: string; [key: string]: unknown }>;
}>;

export type InferenceWorkLotClientCondition =
  | "configuration"
  | "unauthorized"
  | "unreachable"
  | "rate-limited"
  | "rejected"
  | "pending"
  | "malformed"
  | "cancelled";

export declare class InferenceWorkLotClientError extends Error {
  readonly condition: InferenceWorkLotClientCondition;
  readonly retryable: boolean;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export declare function requestInferenceWorkLot(input: Readonly<{
  agentUrl: string;
  request: InferenceWorkLotRequest;
  attemptKey?: string;
  signal?: AbortSignal;
  send?: (...args: readonly unknown[]) => Promise<unknown>;
}>): Promise<InferenceWorkLotExchange>;

export type InferenceWorkBatchJob = Readonly<{
  id: string;
  objective?: string;
  messages?: readonly Readonly<{ role: string; content: string | null }>[];
  context?: unknown;
  contextPacket?: Readonly<Record<string, unknown>>;
  workType?: InferenceWorkLotRequest["workType"];
  taskClass?: string;
  requiredCapabilities?: readonly string[];
  difficulty?: number;
  outputContract?: Readonly<{
    format?: "text" | "json" | "projected";
    mode?: "json_schema";
    schema?: Readonly<Record<string, unknown>>;
    projection?: Readonly<Record<string, unknown>>;
  }>;
  customerProjection?: Readonly<Record<string, unknown>>;
  excludeProviders?: readonly string[];
  mode?: "dry-run" | "live";
  considerationPolicy?: Readonly<Record<string, unknown>>;
  routingProfile?: "bounded" | "extended";
  extendedRoutingRationale?: string;
}>;

export type InferenceWorkBatchResult = Readonly<{
  id: string;
  endpoint?: string;
  provider?: string | null;
  model?: string;
  text?: string;
  usage?: null;
  cost?: unknown;
  attempts: readonly Readonly<Record<string, unknown>>[];
  refusal?: Readonly<{
    type: string;
    reason?: string;
    provider?: string | null;
    problems?: readonly string[];
    settlementResidues?: readonly Readonly<Record<string, unknown>>[];
    [key: string]: unknown;
  }>;
  procurement: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}>;

export interface InferenceWorkBatchOptions {
  readonly agentUrl: string;
  readonly customer: string;
  readonly purpose: string;
  readonly desiredUse: string;
  readonly workLotPrefix: string;
  readonly attemptKey?: string;
  readonly signal?: AbortSignal;
  readonly contract?: (...args: readonly unknown[]) => Promise<unknown>;
  readonly send?: (...args: readonly unknown[]) => Promise<unknown>;
}

export declare function inferenceBatchRequest(
  job: InferenceWorkBatchJob,
  options: Pick<InferenceWorkBatchOptions, "customer" | "purpose" | "desiredUse" | "workLotPrefix">,
): InferenceWorkLotRequest;

export declare function requestInferenceWorkBatch(
  jobs: readonly InferenceWorkBatchJob[],
  options: InferenceWorkBatchOptions,
): Promise<readonly InferenceWorkBatchResult[]>;
