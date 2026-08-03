import {
  ACTIVITYSTREAMS_CONTEXT,
  orderedCollection,
  outboxOf,
  type AgentCard,
  type Activity,
  type Actor,
  type OrderedCollection,
} from "@emsenn/animating";
import { codecs } from "@emsenn/relating";
import type { RWILWitness } from "@emsenn/relating/ledger";
import {
  organizingTheatreActionNamesFromActivities,
  organizingTheatreAgentActorsForEvents,
  organizingTheatreSessionCharacter,
  type OrganizingTheatreSessionCharacterOptions,
  type organizingTheatreSessionCharacterSurface,
} from "./performing/session-character.mjs";
import {
  organizingTheatreInboxActivitiesFor,
  organizingTheatreInboxPerceptionSignal,
  organizingTheatreIsActivity,
  type OrganizingTheatreInboxActivitiesOptions,
  type OrganizingTheatreInboxEvent,
  type OrganizingTheatreInboxPerceptionOptions,
  type organizingTheatreInboxPerceptionSignal as OrganizingTheatreInboxPerceptionSignal,
} from "./performing/inbox-perception.mjs";
import {
  organizingTheatreActiveWorkLocusClaims,
  organizingTheatreStrongestPathOverlap,
  organizingTheatreWorkLocusCapability,
  organizingTheatreWorkLocusCapabilityGrant,
  organizingTheatreWorkLocusCapabilitySignal,
  organizingTheatreWorkLocusClaimConflictsAcross,
  organizingTheatreWorkLocusClaimConflictsFor,
  organizingTheatreWorkLocusClaimFrom,
  type OrganizingTheatreActiveWorkLocusClaim,
  type OrganizingTheatreWorkLocusClaim,
  type OrganizingTheatreWorkLocusClaimConflict,
  type OrganizingTheatreWorkLocusConflictSide,
  type OrganizingTheatreWorkLocusEvent,
  type OrganizingTheatreWorkLocusOptions,
} from "./theatre/work-locus.mjs";
import {
  admittedOrganizingTheatreActionActivities,
  organizingTheatreActivityForEvent,
  type OrganizingTheatreActionDescriptor,
  type OrganizingTheatreActionProjectionOptions,
  type OrganizingTheatreEventActivityInput,
  type OrganizingTheatreEventActivityOptions,
} from "./theatre/event-activity.mjs";
import * as activitypub from "./theatre/activitypub.mjs";

const { eavtRecord } = codecs.text.json.jsonl.eavt;
type EAVT = codecs.text.json.jsonl.eavt.EAVT;
type EAVTRecord = codecs.text.json.jsonl.eavt.EAVTRecord;

export {
  organizingTheatreAgentActorsForEvents,
  organizingTheatreSessionCharacter,
  type OrganizingTheatreSessionCharacterOptions,
  type organizingTheatreSessionCharacterSurface,
} from "./performing/session-character.mjs";

export {
  organizingTheatreActivityAddressedTo,
  organizingTheatreCompactActivitySummary,
  organizingTheatreInboxActivitiesFor,
  organizingTheatreInboxPerceptionSignal,
  organizingTheatreIsActivity,
  type OrganizingTheatreActivitySummary,
  type OrganizingTheatreInboxActivitiesOptions,
  type OrganizingTheatreInboxEvent,
  type OrganizingTheatreInboxPerceptionOptions,
} from "./performing/inbox-perception.mjs";

export {
  organizingTheatreActiveWorkLocusClaims,
  organizingTheatreStrongestPathOverlap,
  organizingTheatreWorkLocusCapability,
  organizingTheatreWorkLocusCapabilityGrant,
  organizingTheatreWorkLocusCapabilitySignal,
  organizingTheatreWorkLocusClaimConflictsAcross,
  organizingTheatreWorkLocusClaimConflictsFor,
  organizingTheatreWorkLocusClaimFrom,
  type OrganizingTheatreActiveWorkLocusClaim,
  type OrganizingTheatreWorkLocusClaim,
  type OrganizingTheatreWorkLocusClaimConflict,
  type OrganizingTheatreWorkLocusConflictSide,
  type OrganizingTheatreWorkLocusEvent,
  type OrganizingTheatreWorkLocusOptions,
} from "./theatre/work-locus.mjs";

export * from "./theatre/activitypub.mjs";
export * from "./theatre/manifold.mjs";
export * from "./theatre/event-activity.mjs";

export interface OrganizingTheatreServiceConfig {
  readonly baseUrl: string;
  readonly name?: string;
  readonly preferredUsername?: string;
  readonly summary?: string;
}

export interface OrganizingTheatreInstanceProfileOptions extends OrganizingTheatreServiceConfig {
  readonly namespace: string;
  readonly capabilityBasePath?: string;
  readonly activityPubFederationClaim?: string;
  readonly inboxClaim?: string;
}

export interface organizingTheatreInstanceProfile {
  readonly namespace: string;
  readonly service: OrganizingTheatreServiceConfig;
  readonly workLocus: OrganizingTheatreWorkLocusOptions;
  readonly kinds: Readonly<{
    readonly agentLocus: string;
    readonly agentMashSignal: string;
    readonly agentSessionHandoff: string;
    readonly agentSessionHandoffResource: string;
    readonly activeWorkLocusCapability: string;
    readonly activityPub: string;
    readonly activityPubActor: string;
    readonly activityPubDelivery: string;
    readonly activityPubInboxDelivery: string;
    readonly activityPubInboxPerception: string;
    readonly activityPubInboxPerceivedAgent: string;
    readonly activityPubOutbox: string;
    readonly capabilityField: string;
    readonly mashActivityPubFederation: string;
    readonly mashActivityPubSignal: string;
    readonly modeledAgentSemioticHub: string;
    readonly workLocusClaim: string;
    readonly workLocusClaimConflict: string;
    readonly activeWorkLocusClaim: string;
    readonly workLocusClaimResult: string;
    readonly agentRelation: string;
  }>;
  readonly inbox: OrganizingTheatreInboxActivitiesOptions & OrganizingTheatreInboxPerceptionOptions;
  readonly activityPubFederation: activitypub.organizingTheatreActivityPubFederationProjectionOptions;
  readonly activityPubOutbox: OrganizingTheatreActivityPubOutboxResourceOptions;
  readonly eventActivity: OrganizingTheatreEventActivityOptions;
}

export interface OrganizingTheatreAgentSignalEvent extends OrganizingTheatreWorkLocusEvent, OrganizingTheatreInboxEvent {
  readonly activity?: unknown;
}

export interface OrganizingTheatreWitnessAgentEventOptions extends OrganizingTheatreEventActivityOptions {
  readonly kind?: string;
  readonly cockpit?: string;
  readonly hookAdmissionKind?: string;
  readonly recordedEventKind?: string;
  readonly hookVerb?: string;
  readonly recordedEventVerb?: string;
  readonly hookSource?: string;
  readonly root?: string;
  readonly namespace?: string;
  readonly defaultSession?: string;
  readonly defaultHarness?: string;
}

export interface OrganizingTheatreAgentSignalOptions extends OrganizingTheatreWorkLocusOptions {
  readonly kind?: string;
  readonly activityPubKind?: string;
  readonly capabilityKind?: string;
  readonly generatedAt?: string;
  readonly now?: Date;
  readonly peerClaims?: number;
  readonly peerCapabilities?: number;
  readonly activeClaimsMax?: number;
  readonly claimConflictsMax?: number;
  readonly inbox?: OrganizingTheatreInboxActivitiesOptions & OrganizingTheatreInboxPerceptionOptions;
}

export interface organizingTheatreAgentSignal {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly harness: string;
  readonly activeClaims: readonly OrganizingTheatreActiveWorkLocusClaim[];
  readonly yourClaims: readonly OrganizingTheatreActiveWorkLocusClaim[];
  readonly peerClaims: readonly OrganizingTheatreActiveWorkLocusClaim[];
  readonly activeCapabilities: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
  readonly yourCapabilities: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
  readonly peerCapabilities: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
  readonly claimConflicts: readonly OrganizingTheatreWorkLocusClaimConflict[];
  readonly yourClaimConflicts: readonly OrganizingTheatreWorkLocusClaimConflict[];
  readonly activityPub: Omit<activitypub.organizingTheatreActivityPubSignal, "kind"> & Readonly<{
    readonly kind: string;
    readonly observer: Readonly<{
      readonly actor: string;
      readonly inbox: OrganizingTheatreInboxPerceptionSignal;
    }>;
  }>;
}

export interface OrganizingTheatreAgentSessionHandoffInput {
  readonly session: string;
  readonly harness: string;
  readonly hookEventName: string;
  readonly lane: unknown;
  readonly recentEvents: readonly unknown[];
  readonly signal: Pick<organizingTheatreAgentSignal, "yourClaims" | "yourClaimConflicts">;
  readonly latestGate?: unknown;
}

export interface OrganizingTheatreAgentSessionHandoffOptions {
  readonly kind?: string;
  readonly generatedAt?: string;
  readonly touchedPathsMax?: number;
  readonly nextInterfaces?: readonly unknown[];
}

export interface organizingTheatreAgentSessionHandoff {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly harness: string;
  readonly hookEventName: string;
  readonly lane: unknown;
  readonly recentEvents: readonly unknown[];
  readonly touchedPaths: readonly string[];
  readonly activeClaims: readonly OrganizingTheatreActiveWorkLocusClaim[];
  readonly claimConflicts: readonly OrganizingTheatreWorkLocusClaimConflict[];
  readonly latestGate: unknown;
  readonly summary: Readonly<{
    readonly recentEvents: number;
    readonly touchedPaths: number;
    readonly activeClaims: number;
    readonly claimConflicts: number;
    readonly lastTool: unknown;
    readonly currentCwd: unknown;
  }>;
  readonly nextInterfaces: readonly unknown[];
}

export interface OrganizingTheatreRecordedAgentSessionHandoffEvent {
  readonly session?: unknown;
  readonly id?: unknown;
  readonly at?: unknown;
  readonly handoff?: unknown;
  readonly handoffCarrier?: unknown;
}

export interface OrganizingTheatreRecordedAgentSessionHandoffOptions {
  readonly handoffKind?: string;
}

export interface OrganizingTheatreAgentSessionHandoffResourceInput {
  readonly session: string;
  readonly recorded?: OrganizingTheatreRecordedAgentSessionHandoffEvent | null;
  readonly handoffCarrier?: unknown;
}

export interface OrganizingTheatreAgentSessionHandoffResourceOptions {
  readonly kind?: string;
  readonly generatedAt?: string;
}

export interface organizingTheatreAgentSessionHandoffResource {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly source: "recorded-handoff" | "current-fold";
  readonly event: string | null;
  readonly at: string | null;
  readonly handoff: unknown;
  readonly handoffCarrier: unknown;
}

export interface OrganizingTheatreCapabilityFieldOptions extends OrganizingTheatreWorkLocusOptions {
  readonly kind?: string;
  readonly activityPubKind?: string;
  readonly capabilityKind?: string;
  readonly generatedAt?: string;
  readonly now?: Date;
  readonly limit?: number;
  readonly activeClaimsMax?: number;
  readonly claimConflictsMax?: number;
  readonly nextInterfaces?: readonly unknown[];
}

export interface organizingTheatreCapabilityField {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly harness: string;
  readonly focusPaths: readonly string[];
  readonly summary: Readonly<{
    readonly activeCapabilities: number;
    readonly yourCapabilities: number;
    readonly peerCapabilities: number;
    readonly relevantCapabilities: number;
    readonly claimConflicts: number;
    readonly relevantConflicts: number;
  readonly activityPub: Omit<activitypub.organizingTheatreActivityPubSignal, "kind"> & Readonly<{ readonly kind: string }>;
  }>;
  readonly capabilities: Readonly<{
    readonly yours: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
    readonly peers: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
    readonly relevant: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
  }>;
  readonly conflicts: Readonly<{
    readonly yours: readonly OrganizingTheatreWorkLocusClaimConflict[];
    readonly relevant: readonly OrganizingTheatreWorkLocusClaimConflict[];
  }>;
  readonly nextInterfaces: readonly unknown[];
}

export interface OrganizingTheatreActivityPubOutboxResourceOptions {
  readonly kind?: string;
  readonly signalKind?: string;
  readonly federationKind?: string;
  readonly deliveryKind?: string;
  readonly generatedAt?: string;
  readonly limit?: number;
  readonly nextInterfaces?: readonly unknown[];
}

export interface organizingTheatreActivityPubOutboxResource {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly harness: string;
  readonly scope: "theatre" | "actor";
  readonly actor: string | null;
  readonly context: typeof ACTIVITYSTREAMS_CONTEXT;
  readonly totalActivities: number;
  readonly window: number;
  readonly outbox: OrderedCollection;
  readonly actors: readonly Readonly<{
    readonly id: string;
    readonly type: string;
    readonly preferredUsername: string;
    readonly inbox: string;
    readonly outbox: string;
  }>[];
  readonly federation: unknown;
  readonly signal: Omit<activitypub.organizingTheatreActivityPubSignal, "kind"> & Readonly<{ readonly kind: string }>;
  readonly nextInterfaces: readonly unknown[];
}

export interface OrganizingTheatreActivityPubActorResourceOptions extends OrganizingTheatreWorkLocusOptions {
  readonly kind?: string;
  readonly generatedAt?: string;
  readonly capabilityKind?: string;
  readonly inbox?: OrganizingTheatreInboxActivitiesOptions & OrganizingTheatreInboxPerceptionOptions;
  readonly limit?: number;
  readonly outboxResourceOptions?: OrganizingTheatreActivityPubOutboxResourceOptions;
  readonly nextInterfaces?: readonly unknown[];
}

export interface organizingTheatreActivityPubActorResource {
  readonly kind: string;
  readonly generatedAt: string;
  readonly session: string;
  readonly harness: string;
  readonly actor: Actor;
  readonly sessionCharacter: organizingTheatreSessionCharacterSurface | null;
  readonly agentCard: AgentCard | null;
  readonly summary: Readonly<{
    readonly activities: number;
    readonly inboxActivities: number;
    readonly inboxPerception: unknown;
    readonly activeCapabilities: number;
    readonly lastEventAt: string | null;
    readonly lastTool: string | null;
    readonly focusPaths: readonly string[];
  }>;
  readonly capabilities: readonly ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal>[];
  readonly outbox: OrderedCollection;
  readonly inbox: OrderedCollection;
  readonly inboxPerception: OrganizingTheatreInboxPerceptionSignal;
  readonly nextInterfaces: readonly unknown[];
}

function trimmedBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (trimmed === "") throw new TypeError("OrganizingTheatre baseUrl must not be empty");
  return trimmed;
}

export function organizingTheatreAgentEventsFromWitnessRows(
  rows: readonly (EAVT | EAVTRecord | RWILWitness)[],
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreWitnessAgentEventOptions = {},
): readonly OrganizingTheatreAgentSignalEvent[] {
  return Object.freeze(rows
    .map((row, index) => organizingTheatreAgentEventFromWitnessRow(eavtRecord(row), config, options, index))
    .filter((event): event is OrganizingTheatreAgentSignalEvent => event !== null));
}

function organizingTheatreAgentEventFromWitnessRow(
  row: EAVTRecord,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreWitnessAgentEventOptions,
  index: number,
): OrganizingTheatreAgentSignalEvent | null {
  const attribute = OrganizingTheatreRecord(row.a);
  const value = OrganizingTheatreRecord(row.v);
  if (attribute === null || value === null) return null;
  const verb = stringField(attribute, "verb");
  if (verb === (options.recordedEventVerb ?? "record-dev-event") && value.kind === (options.recordedEventKind ?? options.kind ?? "organizing.theatre.agent-event")) {
    return normalizeWitnessAgentEvent(value, config, options);
  }
  if (verb !== (options.hookVerb ?? "admit-hook-event")) return null;
  if (value.kind !== (options.hookAdmissionKind ?? "information-coherence-kernel.hook.admission")) return null;
  const payload = OrganizingTheatreRecord(value.payload) ?? {
    hook_event_name: stringField(value, "hookEventName") ?? "HookEvent",
    session_id: stringField(value, "session") ?? (options.defaultSession ?? "unknown-session"),
    harness: stringField(value, "harness") ?? (options.defaultHarness ?? "agent"),
    ...(stringField(value, "cwd") === null ? {} : { cwd: stringField(value, "cwd") }),
    ...(stringField(value, "tool") === null ? {} : { tool_name: stringField(value, "tool") }),
  };
  const at = typeof row.t === "string" ? row.t : new Date(0).toISOString();
  const session = stringField(value, "session") ?? stringField(payload, "session_id") ?? stringField(payload, "session") ?? (options.defaultSession ?? "unknown-session");
  const harness = stringField(value, "harness") ?? stringField(payload, "harness") ?? (options.defaultHarness ?? "agent");
  const hook = stringField(value, "hookEventName") ?? stringField(payload, "hook_event_name") ?? "HookEvent";
  return normalizeWitnessAgentEvent({
    kind: options.kind ?? "organizing.theatre.agent-event",
    at,
    id: `ick-hook-event:${stableHash([row.e, row.a, row.v, row.t]).slice(0, 24)}`,
    source: options.hookSource ?? "information-coherence-kernel.admit-hook-event",
    ...(options.cockpit === undefined ? {} : { cockpit: options.cockpit }),
    harness,
    session,
    hookEventName: hook,
    payload,
    ickWitness: {
      ...(options.root === undefined ? {} : { root: options.root }),
      namespace: options.namespace ?? "root",
      caller: row.e ?? null,
      verb: options.hookVerb ?? "admit-hook-event",
    },
  }, config, options, index);
}

function normalizeWitnessAgentEvent(
  event: Readonly<Record<string, unknown>>,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreWitnessAgentEventOptions,
  index = 0,
): OrganizingTheatreAgentSignalEvent {
  if (organizingTheatreIsActivity(event.activity)) return event as OrganizingTheatreAgentSignalEvent;
  const id = stringField(event, "id") ?? `organizing-theatre-event:${stableHash([event, index]).slice(0, 24)}`;
  const at = stringField(event, "at") ?? new Date(0).toISOString();
  const source = stringField(event, "source") ?? "organizing.theatre.witness";
  const session = stringField(event, "session") ?? (options.defaultSession ?? "unknown-session");
  const harness = stringField(event, "harness") ?? (options.defaultHarness ?? "agent");
  const hook = stringField(event, "hookEventName") ?? "HookEvent";
  const payload = OrganizingTheatreRecord(event.payload) ?? {};
  const { activity: _activity, ...extra } = event;
  return Object.freeze({
    ...event,
    id,
    at,
    source,
    session,
    harness,
    hookEventName: hook,
    payload,
    activity: organizingTheatreActivityForEvent({
      id,
      at,
      source,
      session,
      harness,
      hookEventName: hook,
      payload,
      extra,
    }, config, options),
  }) as OrganizingTheatreAgentSignalEvent;
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stableHash(value: unknown): string {
  let h = 2166136261;
  for (const char of JSON.stringify(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function organizingTheatreInstanceProfile(options: OrganizingTheatreInstanceProfileOptions): organizingTheatreInstanceProfile {
  const namespace = options.namespace.replace(/\.+$/u, "");
  const service: OrganizingTheatreServiceConfig = {
    baseUrl: options.baseUrl,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.preferredUsername === undefined ? {} : { preferredUsername: options.preferredUsername }),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
  };
  const kinds = Object.freeze({
    agentLocus: `${namespace}.agent-locus`,
    agentMashSignal: `${namespace}.agent-mash-signal`,
    agentSessionHandoff: `${namespace}.agent-session-handoff`,
    agentSessionHandoffResource: `${namespace}.agent-session-handoff-resource`,
    activeWorkLocusCapability: `${namespace}.active-work-locus-capability`,
    activityPub: `${namespace}.mash-activitypub`,
    activityPubActor: `${namespace}.activitypub-actor`,
    activityPubDelivery: `${namespace}.mash-activitypub-delivery`,
    activityPubInboxDelivery: `${namespace}.activitypub-inbox-delivery`,
    activityPubInboxPerception: `${namespace}.activitypub-inbox-perception`,
    activityPubInboxPerceivedAgent: `${namespace}.activitypub-inbox-perceived-agent`,
    activityPubOutbox: `${namespace}.activitypub-outbox`,
    capabilityField: `${namespace}.capability-field`,
    mashActivityPubFederation: `${namespace}.mash-activitypub-federation`,
    mashActivityPubSignal: `${namespace}.mash-activitypub-signal`,
    modeledAgentSemioticHub: `${namespace}.modeled-agent-semiotic-hub`,
    workLocusClaim: `${namespace}.work-locus-claim`,
    workLocusClaimConflict: `${namespace}.work-locus-claim-conflict`,
    activeWorkLocusClaim: `${namespace}.active-work-locus-claim`,
    workLocusClaimResult: `${namespace}.work-locus-claim-result`,
    agentRelation: `${namespace}.agent-relation`,
  });
  const workLocus = Object.freeze({
    claimKind: kinds.workLocusClaim,
    activeKind: kinds.activeWorkLocusClaim,
    conflictKind: kinds.workLocusClaimConflict,
    ...(options.capabilityBasePath === undefined ? {} : { capabilityBasePath: options.capabilityBasePath }),
  });
  const inbox = Object.freeze({
    inboxSource: `${namespace}.activitypub-inbox`,
    kind: kinds.activityPubInboxPerception,
    claim: options.inboxClaim ?? "Inbound ActivityPub Activities are folded through animating's perceiveInbox leg, so an agent inbox is read as an agent membrane.",
    perceivedAgentKind: kinds.activityPubInboxPerceivedAgent,
  });
  return Object.freeze({
    namespace,
    service: Object.freeze(service),
    workLocus,
    kinds,
    inbox,
    activityPubFederation: Object.freeze({
      kind: kinds.mashActivityPubFederation,
      claim: options.activityPubFederationClaim ?? "MASH sessions are ActivityPub actors grouped into harness camps and delivered through organizing federation.",
      deliveryKind: kinds.activityPubDelivery,
    }),
    activityPubOutbox: Object.freeze({
      kind: kinds.activityPubOutbox,
      signalKind: kinds.mashActivityPubSignal,
      federationKind: kinds.mashActivityPubFederation,
      deliveryKind: kinds.activityPubDelivery,
    }),
    eventActivity: Object.freeze({
      ...workLocus,
      handoffKind: kinds.agentSessionHandoff,
    }),
  });
}

export function organizingTheatreAgentSignal(
  input: Readonly<{
    readonly session: string;
    readonly harness: string;
    readonly events: readonly OrganizingTheatreAgentSignalEvent[];
    readonly activities?: readonly Activity[];
    readonly activeClaims?: readonly OrganizingTheatreActiveWorkLocusClaim[];
    readonly claimConflicts?: readonly OrganizingTheatreWorkLocusClaimConflict[];
    readonly inboxActivities?: readonly Activity[];
    readonly seedActors?: readonly Actor[];
    readonly actorId?: string;
  }>,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreAgentSignalOptions = {},
): organizingTheatreAgentSignal {
  const actorId = input.actorId ?? activitypub.organizingTheatreAgentActorId(config, input.harness, input.session);
  const activeClaims = input.activeClaims ?? organizingTheatreActiveWorkLocusClaims(input.events, config, {
    ...options,
    ...(options.activeClaimsMax === undefined ? {} : { max: options.activeClaimsMax }),
  });
  const claimConflicts = input.claimConflicts ?? organizingTheatreWorkLocusClaimConflictsAcross(activeClaims, config, {
    ...options,
    ...(options.claimConflictsMax === undefined ? {} : { max: options.claimConflictsMax }),
  });
  const activities = input.activities ?? input.events.map((event) => event.activity).filter(organizingTheatreIsActivity);
  const inboxActivities = input.inboxActivities ?? organizingTheatreInboxActivitiesFor(
    input.events,
    actorId,
    options.inbox?.inboxSource === undefined ? {} : { inboxSource: options.inbox.inboxSource },
  );
  const activeCapabilities = activeClaims.map((claim) => OrganizingTheatreCapabilitySignalForAgentSignal(claim, config, options));
  const activityPub = activitypub.organizingTheatreActivityPubSignal(activities, config, input.seedActors);
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.agent-signal",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    harness: input.harness,
    activeClaims,
    yourClaims: Object.freeze(activeClaims.filter((claim) => claim.session === input.session)),
    peerClaims: Object.freeze(activeClaims.filter((claim) => claim.session !== input.session).slice(0, options.peerClaims ?? 8)),
    activeCapabilities: Object.freeze(activeCapabilities),
    yourCapabilities: Object.freeze(activeCapabilities.filter((capability) => capability.session === input.session)),
    peerCapabilities: Object.freeze(activeCapabilities.filter((capability) => capability.session !== input.session).slice(0, options.peerCapabilities ?? 8)),
    claimConflicts,
    yourClaimConflicts: Object.freeze(claimConflicts.filter((conflict) => conflict.left.session === input.session || conflict.right.session === input.session)),
    activityPub: Object.freeze({
      ...activityPub,
      ...(options.activityPubKind === undefined ? {} : { kind: options.activityPubKind }),
      observer: Object.freeze({
        actor: actorId,
        inbox: organizingTheatreInboxPerceptionSignal(actorId, inboxActivities, options.inbox),
      }),
    }),
  });
}

export function organizingTheatreAgentSessionHandoff(
  input: OrganizingTheatreAgentSessionHandoffInput,
  options: OrganizingTheatreAgentSessionHandoffOptions = {},
): organizingTheatreAgentSessionHandoff {
  const touchedPathsMax = Math.max(0, options.touchedPathsMax ?? 24);
  const lane = OrganizingTheatreRecord(input.lane);
  const laneFocusPaths = OrganizingTheatreStringArray(lane?.focusPaths);
  const claimPaths = input.signal.yourClaims.flatMap((claim) => claim.paths ?? []);
  const touchedPaths = [...new Set([...laneFocusPaths, ...claimPaths])]
    .filter((item) => item !== "")
    .slice(0, touchedPathsMax);
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.agent-session-handoff",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    harness: input.harness,
    hookEventName: input.hookEventName,
    lane: input.lane,
    recentEvents: Object.freeze([...input.recentEvents]),
    touchedPaths: Object.freeze(touchedPaths),
    activeClaims: Object.freeze([...input.signal.yourClaims]),
    claimConflicts: Object.freeze([...input.signal.yourClaimConflicts]),
    latestGate: input.latestGate ?? null,
    summary: Object.freeze({
      recentEvents: input.recentEvents.length,
      touchedPaths: touchedPaths.length,
      activeClaims: input.signal.yourClaims.length,
      claimConflicts: input.signal.yourClaimConflicts.length,
      lastTool: lane?.lastTool ?? null,
      currentCwd: lane?.currentCwd ?? null,
    }),
    nextInterfaces: Object.freeze([...(options.nextInterfaces ?? [])]),
  });
}

export function organizingTheatreLatestRecordedAgentSessionHandoff(
  events: readonly OrganizingTheatreRecordedAgentSessionHandoffEvent[],
  session: string,
  options: OrganizingTheatreRecordedAgentSessionHandoffOptions = {},
): OrganizingTheatreRecordedAgentSessionHandoffEvent | null {
  const handoffKind = options.handoffKind ?? "organizing.theatre.agent-session-handoff";
  return [...events]
    .reverse()
    .find((event) => event.session === session
      && OrganizingTheatreRecord(event.handoffCarrier)?.kind === handoffKind) ?? null;
}

export function organizingTheatreAgentSessionHandoffResource(
  input: OrganizingTheatreAgentSessionHandoffResourceInput,
  options: OrganizingTheatreAgentSessionHandoffResourceOptions = {},
): organizingTheatreAgentSessionHandoffResource {
  const recorded = input.recorded ?? null;
  if (recorded !== null) {
    return Object.freeze({
      kind: options.kind ?? "organizing.theatre.agent-session-handoff-resource",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      session: input.session,
      source: "recorded-handoff" as const,
      event: typeof recorded.id === "string" ? recorded.id : null,
      at: typeof recorded.at === "string" ? recorded.at : null,
      handoff: recorded.handoff ?? null,
      handoffCarrier: recorded.handoffCarrier ?? null,
    });
  }
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.agent-session-handoff-resource",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    source: "current-fold" as const,
    event: null,
    at: null,
    handoff: null,
    handoffCarrier: input.handoffCarrier ?? null,
  });
}

export function organizingTheatreCapabilityField(
  input: Readonly<{
    readonly session: string;
    readonly harness: string;
    readonly events: readonly OrganizingTheatreAgentSignalEvent[];
    readonly focusPaths?: readonly string[];
    readonly activities?: readonly Activity[];
    readonly activeClaims?: readonly OrganizingTheatreActiveWorkLocusClaim[];
    readonly claimConflicts?: readonly OrganizingTheatreWorkLocusClaimConflict[];
    readonly seedActors?: readonly Actor[];
  }>,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreCapabilityFieldOptions = {},
): organizingTheatreCapabilityField {
  const limit = Math.max(0, options.limit ?? 16);
  const focusPaths = Object.freeze([...(input.focusPaths ?? [])].filter((item) => item !== ""));
  const activeClaims = input.activeClaims ?? organizingTheatreActiveWorkLocusClaims(input.events, config, {
    ...options,
    ...(options.activeClaimsMax === undefined ? {} : { max: options.activeClaimsMax }),
  });
  const activeCapabilities = activeClaims.map((claim) => OrganizingTheatreCapabilitySignalForCapabilityField(claim, config, options));
  const claimConflicts = input.claimConflicts ?? organizingTheatreWorkLocusClaimConflictsAcross(activeClaims, config, {
    ...options,
    ...(options.claimConflictsMax === undefined ? {} : { max: options.claimConflictsMax }),
  });
  const focusSet = new Set(focusPaths);
  const relevantCapabilities = focusPaths.length === 0
    ? activeCapabilities
    : activeCapabilities.filter((capability) => capability.paths.some((claimPath) => organizingTheatreStrongestPathOverlap(focusSet, claimPath) !== null));
  const relevantConflicts = focusPaths.length === 0
    ? claimConflicts
    : claimConflicts.filter((conflict) => organizingTheatreStrongestPathOverlap(focusSet, conflict.path) !== null);
  const activities = input.activities ?? input.events.map((event) => event.activity).filter(organizingTheatreIsActivity);
  const activityPub = activitypub.organizingTheatreActivityPubSignal(activities, config, input.seedActors);
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.capability-field",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    harness: input.harness,
    focusPaths,
    summary: Object.freeze({
      activeCapabilities: activeCapabilities.length,
      yourCapabilities: activeCapabilities.filter((capability) => capability.session === input.session).length,
      peerCapabilities: activeCapabilities.filter((capability) => capability.session !== input.session).length,
      relevantCapabilities: relevantCapabilities.length,
      claimConflicts: claimConflicts.length,
      relevantConflicts: relevantConflicts.length,
      activityPub: Object.freeze({
        ...activityPub,
        ...(options.activityPubKind === undefined ? {} : { kind: options.activityPubKind }),
      }),
    }),
    capabilities: Object.freeze({
      yours: Object.freeze(activeCapabilities.filter((capability) => capability.session === input.session).slice(0, limit)),
      peers: Object.freeze(activeCapabilities.filter((capability) => capability.session !== input.session).slice(0, limit)),
      relevant: Object.freeze(relevantCapabilities.slice(0, limit)),
    }),
    conflicts: Object.freeze({
      yours: Object.freeze(claimConflicts.filter((conflict) => conflict.left.session === input.session || conflict.right.session === input.session).slice(0, limit)),
      relevant: Object.freeze(relevantConflicts.slice(0, limit)),
    }),
    nextInterfaces: Object.freeze([...(options.nextInterfaces ?? [])]),
  });
}

export function organizingTheatreActivityPubOutboxResource(
  input: Readonly<{
    readonly session: string;
    readonly harness: string;
    readonly events: readonly OrganizingTheatreAgentSignalEvent[];
    readonly actor?: string | null;
    readonly admittedActionActivities?: readonly Activity[];
    readonly seedActors?: readonly Actor[];
  }>,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreActivityPubOutboxResourceOptions = {},
): organizingTheatreActivityPubOutboxResource {
  const limit = Math.max(0, options.limit ?? 24);
  const serviceActor = activitypub.organizingTheatreServiceProjection(config).actor.id;
  const actor = input.actor ?? null;
  const eventActivities = input.events.map((event) => event.activity).filter(organizingTheatreIsActivity);
  const allActivities = actor === null || actor === serviceActor
    ? [...eventActivities, ...(input.admittedActionActivities ?? [])]
    : eventActivities;
  const activities = actor === null ? allActivities : allActivities.filter((activity) => activity.actor === actor);
  const window = activities.slice(-limit);
  const actors = activitypub.organizingTheatreActivityPubActors(window, config, input.seedActors);
  const federation = activitypub.organizingTheatreActivityPubFederation(window, config, input.seedActors);
  const signal = activitypub.organizingTheatreActivityPubSignal(window, config, input.seedActors);
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.activitypub-outbox",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    harness: input.harness,
    scope: actor === null ? "theatre" : "actor",
    actor,
    context: ACTIVITYSTREAMS_CONTEXT,
    totalActivities: activities.length,
    window: window.length,
    outbox: actor === null || actor === serviceActor ? activitypub.organizingTheatreOutbox(window, config) : outboxOf(window, `${actor}/outbox`),
    actors: Object.freeze(actors.map((item) => Object.freeze({
      id: item.id,
      type: item.type,
      preferredUsername: item.preferredUsername,
      inbox: item.inbox,
      outbox: item.outbox,
    }))),
    federation: organizingTheatreActivityPubFederationWithKinds(federation, options),
    signal: Object.freeze({
      ...signal,
      ...(options.signalKind === undefined ? {} : { kind: options.signalKind }),
    }),
    nextInterfaces: Object.freeze([...(options.nextInterfaces ?? [])]),
  });
}

export function organizingTheatreActivityPubActorResource(
  input: Readonly<{
    readonly session: string;
    readonly harness: string;
    readonly actorId: string;
    readonly events: readonly OrganizingTheatreAgentSignalEvent[];
    readonly admittedActionActivities?: readonly Activity[];
    readonly seedActors?: readonly Actor[];
    readonly activeClaims?: readonly OrganizingTheatreActiveWorkLocusClaim[];
    readonly actor?: Actor;
    readonly lane?: Readonly<{
      readonly lastEventAt?: string | null;
      readonly lastTool?: string | null;
      readonly focusPaths?: readonly string[];
    }> | null;
    readonly actorHarness?: string;
    readonly actorSession?: string;
  }>,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreActivityPubActorResourceOptions = {},
): organizingTheatreActivityPubActorResource {
  const limit = Math.max(0, options.limit ?? 12);
  const serviceProjection = activitypub.organizingTheatreServiceProjection(config);
  const serviceActor = serviceProjection.actor.id;
  const isServiceActor = input.actorId === serviceActor;
  const activeClaims = input.activeClaims ?? organizingTheatreActiveWorkLocusClaims(input.events, config, options);
  const actorEvents = isServiceActor ? [] : input.events.filter((event) => organizingTheatreIsActivity(event.activity) && event.activity.actor === input.actorId);
  const actorActivities = actorEvents.map((event) => event.activity).filter(organizingTheatreIsActivity);
  const actorClaims = isServiceActor
    ? activeClaims
    : activeClaims.filter((claim) => activitypub.organizingTheatreAgentActorId(config, claim.harness, claim.session) === input.actorId);
  const inboxActivities = organizingTheatreInboxActivitiesFor(
    input.events,
    input.actorId,
    options.inbox?.inboxSource === undefined ? {} : { inboxSource: options.inbox.inboxSource },
  );
  const inboxPerception = organizingTheatreInboxPerceptionSignal(input.actorId, inboxActivities, options.inbox);
  const sessionCharacter = isServiceActor ? null : organizingTheatreSessionCharacter(config, input.actorHarness ?? input.harness, input.actorSession ?? input.session, {
    actorId: input.actorId,
    events: input.events,
    activities: actorActivities,
    admittedActions: organizingTheatreActionNamesFromActivities(input.admittedActionActivities ?? []),
    ...(input.lane === undefined ? {} : { lane: input.lane }),
  });
  const actor = input.actor ?? (isServiceActor
    ? serviceProjection.actor
    : actorActivities.length === 0 && actorEvents.length === 0
    ? activitypub.organizingTheatreAgentActorFromIri(input.actorId, config, {
      events: input.events,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
    })
    : activitypub.organizingTheatreAgentActorForLocus(config, input.actorHarness ?? input.harness, {
      session: input.actorSession ?? input.session,
      hooks: actorEvents.length,
      lastTool: input.lane?.lastTool ?? null,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
    }, {
      actorId: input.actorId,
      events: input.events,
      activities: actorActivities,
      admittedActions: organizingTheatreActionNamesFromActivities(input.admittedActionActivities ?? []),
      ...(input.lane === undefined ? {} : { lane: input.lane }),
    }));
  const outboxResource = isServiceActor
    ? organizingTheatreActivityPubOutboxResource({
      session: input.session,
      harness: input.harness,
      events: input.events,
      actor: serviceActor,
      ...(input.admittedActionActivities === undefined ? {} : { admittedActionActivities: input.admittedActionActivities }),
      ...(input.seedActors === undefined ? {} : { seedActors: input.seedActors }),
    }, config, options.outboxResourceOptions)
    : null;
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.activitypub-actor",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    session: input.session,
    harness: input.harness,
    actor,
    sessionCharacter,
    agentCard: sessionCharacter?.agentCard ?? null,
    summary: Object.freeze({
      activities: isServiceActor ? outboxResource?.totalActivities ?? 0 : actorActivities.length,
      inboxActivities: inboxActivities.length,
      inboxPerception: inboxPerception.agent === null ? null : inboxPerception.agent,
      activeCapabilities: actorClaims.length,
      lastEventAt: isServiceActor ? null : input.lane?.lastEventAt ?? null,
      lastTool: isServiceActor ? null : input.lane?.lastTool ?? null,
      focusPaths: Object.freeze(isServiceActor ? [] : [...(input.lane?.focusPaths ?? [])]),
    }),
    capabilities: Object.freeze(actorClaims.map((claim) => OrganizingTheatreCapabilitySignalForActorResource(claim, config, options))),
    outbox: isServiceActor
      ? outboxResource?.outbox ?? activitypub.organizingTheatreOutbox([], config)
      : outboxOf(actorActivities.slice(-limit), actor.outbox),
    inbox: isServiceActor
      ? activitypub.organizingTheatreInbox(inboxActivities.slice(-limit), config)
      : orderedCollection(inboxActivities.slice(-limit), actor.inbox),
    inboxPerception,
    nextInterfaces: Object.freeze([...(options.nextInterfaces ?? [])]),
  });
}

function OrganizingTheatreCapabilitySignalForAgentSignal(
  claim: OrganizingTheatreWorkLocusClaim | OrganizingTheatreActiveWorkLocusClaim,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreAgentSignalOptions,
): ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal> {
  const signal = organizingTheatreWorkLocusCapabilitySignal(claim, config, options);
  return Object.freeze({
    ...signal,
    ...(options.capabilityKind === undefined ? {} : { kind: options.capabilityKind }),
  });
}

function OrganizingTheatreCapabilitySignalForCapabilityField(
  claim: OrganizingTheatreWorkLocusClaim | OrganizingTheatreActiveWorkLocusClaim,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreCapabilityFieldOptions,
): ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal> {
  const signal = organizingTheatreWorkLocusCapabilitySignal(claim, config, options);
  return Object.freeze({
    ...signal,
    ...(options.capabilityKind === undefined ? {} : { kind: options.capabilityKind }),
  });
}

function OrganizingTheatreCapabilitySignalForActorResource(
  claim: OrganizingTheatreWorkLocusClaim | OrganizingTheatreActiveWorkLocusClaim,
  config: OrganizingTheatreServiceConfig,
  options: OrganizingTheatreActivityPubActorResourceOptions,
): ReturnType<typeof organizingTheatreWorkLocusCapabilitySignal> {
  const signal = organizingTheatreWorkLocusCapabilitySignal(claim, config, options);
  return Object.freeze({
    ...signal,
    ...(options.capabilityKind === undefined ? {} : { kind: options.capabilityKind }),
  });
}

function organizingTheatreActivityPubFederationWithKinds(
  federation: activitypub.organizingTheatreActivityPubFederation,
  options: OrganizingTheatreActivityPubOutboxResourceOptions,
): unknown {
  if (options.federationKind === undefined && options.deliveryKind === undefined) return federation;
  const projectionOptions: activitypub.organizingTheatreActivityPubFederationProjectionOptions = {
    claim: "Organizing theatre ActivityPub actors are grouped into harness camps and delivered through organizing federation.",
  };
  if (options.federationKind !== undefined) {
    Object.assign(projectionOptions, { kind: options.federationKind });
  }
  if (options.deliveryKind !== undefined) {
    Object.assign(projectionOptions, { deliveryKind: options.deliveryKind });
  }
  return organizingTheatreActivityPubFederationProjectionFrom(federation, projectionOptions);
}

function organizingTheatreActivityPubFederationProjectionFrom(
  federation: activitypub.organizingTheatreActivityPubFederation,
  options: activitypub.organizingTheatreActivityPubFederationProjectionOptions,
): activitypub.organizingTheatreActivityPubFederationProjection {
  return Object.freeze({
    kind: options.kind ?? "organizing.theatre.activitypub-federation",
    claim: options.claim ?? "OrganizingTheatre sessions are ActivityPub actors grouped into harness camps and delivered through organizing federation.",
    camps: Object.freeze(federation.camps.map((camp) => Object.freeze({
      id: camp.id,
      members: camp.members,
      sharedInbox: camp.sharedInbox ?? null,
    }))),
    deliveries: Object.freeze(federation.deliveries.map((delivery) => Object.freeze({
      ...delivery,
      kind: options.deliveryKind ?? delivery.kind,
    }))),
    reading: federation.reading,
  });
}

function OrganizingTheatreRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function OrganizingTheatreStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
