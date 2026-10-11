# Gemini Notebook Services Section

A directly contractable Support Node Metro-Enterprise owned by Red Cup
Engineering's Logical Inference Service Section. It provides source-grounded
Gemini Notebook reports, mind maps, native infographic PNGs, audio summaries, cinematic videos, explainer videos, native vertical Shorts, schema-bound JSON, native data-table CSV, and JSON-carried code proposals while keeping the unofficial Google client,
authentication mechanics, provider failures, and provider evidence inside its
own membrane.

## Semiotic Exchange Chain witness mode

Set `SEMIOTIC_EXCHANGE_CHAIN=1` with `EVM_RPC_URL`, `EVM_KEYSTORE_PATH`,
`EVM_KEYSTORE_PASSWORD_PATH`, and `ONCHAIN_RESOURCE_CONTRACT` to settle
provider witness records directly on `eip155:5615610`. This reuses the
ActivityPub service's ERC-5219 resource membrane; no local WitnessJournal service is
required. Witnesses are content-addressed and indexed on-chain for async
recovery. The unset flag is reserved for explicit legacy fixtures and requires
`WITNESS_JOURNAL_RDF_AGENT`.

The earlier one-exchange pilot proved that the client could produce an
artifact. Its allocation record remains historical evidence; it is not a live
admission gate. Current authority comes from each accepted executable offer.

Notebook creation is not admitted by this provider's own customer allowlist.
A live creation must
name one exact grant and authorization-request digest, and this provider must
hire the separately sovereign `notebook-creation-authorization-service` to
reobserve that the grant is potential, one-use, nondelegable, and bound to this
provider, beneficiary, and title before it records an effect intent. The
authorization service owns personal-Leader admission and custody assignment;
this provider owns only the Google creation effect and its receipt.

## Trusted live notebook library

`serve-notebook-knowledge-library` starts the local MCP adapter for the
provider's already-authenticated notebook library. Its read surfaces can list
visible notebooks, inspect one notebook's source topology, list its existing
Studio resources, get one exact resource's metadata, and retrieve one completed
report as bounded UTF-8 Markdown. Report retrieval uses an ephemeral local
carrier, returns its byte count and SHA-256 digest with the content, and removes
the carrier before returning. Provider subprocesses have a finite two-minute
default timeout (configurable only inside the provider adapter), and the MCP
text summary omits the report body that is already present in structured
content.

These operations observe or download existing provider state. They do not
create, retry, rename, export, or delete a Studio artifact. New Studio work
continues to use the separately metered workspace contract. Live notebook and
artifact identifiers are intentionally visible on this trusted local operator
surface; callers crossing an untrusted membrane must use the opaque L-space
catalog instead.

## Local report-to-video production

`./report-video` exports `advanceNotebookVideo`, `adoptNotebookVideo`,
`retryNotebookVideo`, and `NotebookVideoBlocked` for local consumers that
already own a Gemini notebook and a durable checkpoint. The advance
operation accepts a report path, output path, exact notebook and source title,
video settings, and the caller's checkpoint. `onCheckpoint` persists each
source-upload and video-submission boundary; `onRecord` receives concise step
records. The returned checkpoint can be stored alongside a lesson, article, or
other caller-owned work item. Pending generation and uncertain submission
return `NotebookVideoBlocked` with the checkpoint to persist; a
provider-confirmed failure returns `video-failed`. Adoption always names one
exact artifact ID; retry only resets a provider-confirmed failed artifact, and
the next submission is a new request that may carry different video settings.
How many attempts a video gets, and in which formats, is the caller's policy.
It does not create a
notebook, select work, own channel policy, schedule work, or depend on the
provider's journal-backed remote contract. An existing valid MP4 is adopted
after an interrupted checkpoint; if the transient local file later disappears,
the same completed provider artifact is downloaded again and its recorded
digest must match. The operation never regenerates that video during download
recovery.

## Account usage windows

New video and companion production reads the provider's actual current-window
and weekly compute usage through `./quota`. Each admission gets a fresh reading;
100% usage or an unavailable reading pauses new submissions. Accepted artifacts
continue through reconciliation, download and media retention without another
quota admission. A provider RATE_LIMITED answer may still have made an artifact,
so the exact saved submission is reconciled before retrying.

Google's compute pool refreshes every five hours under a weekly limit. Prompt
complexity, feature and model affect consumption. There is no fixed price per
video. Native vertical Short (format 4) and landscape Brief (format 2) are
separate products. `content/config/allowances.json`, `gemini-notebook-allowance
sync`, `refused`, and `report` retain historical evidence and priors; they do not
admit production. `gemini-notebook-allowance status` reports native usage.

Public education owns the work order: accepted work first, new turns shared
across channels according to publication needs, and optional companions last.
Its server timer resumes work after limits refresh; Flow uses its own credits.

## One source and hosted execution

The package in `emsenn/bare-cedar-fog` is the maintained implementation. The
Cold Red Gate installer builds only from a committed Git revision and deploys
the complete package: library and bucket reads, contracts, source reconciliation,
Python realizers, schemas, Studio work and report-to-video production. The host
and media workers import that same package; media bundles contain no private
Notebook copy. Provider authentication, the locked notebooklm-py SDK, production
checkpoints and generated media custody remain server-owned.

From Bare Cedar Fog or another SSH client:

```sh
ssh cold-red-gate '~/.local/bin/gemini-notebook usage'
ssh cold-red-gate '~/.local/bin/gemini-notebook library'
ssh cold-red-gate '~/.local/bin/gemini-notebook serve-notebook-knowledge-library'
```

The operator entry also exposes the existing package bin names and `sdk <args>`.
`source.json` in each deployed release identifies its repository and exact Git
revision. Updating the provider does not overwrite credentials, reports,
production state or media. Bare Cedar Fog is an authoring/SSH client; automated
media production runs on Cold Red Gate and retains media in Google Drive.

## Executable contract face

`package.json` publishes two provider-owned artifact operations and two
provider-owned stable-corpus operations:

- `solicit-service` accepts an ActivityStreams
  `Offer<ServiceSolicitation>`. The provider—not LMT—recognizes Gemini Notebook
  intent, checks whether sources, prompt, artifact type, and execution mode are
  present, and returns an executable offer, a question for missing terms, or a
  refusal.
- `invoke-service` accepts the provider's offer as a
  `ServiceContract` carrying an attenuated capability. It validates that the
  capability is bound to the exact request digest and invokes the exchange
  harness.
- `solicit-source-reconciliation` offers either a network-only observation of
  one exact notebook's source IDs or a staged replacement bound to an exact
  previously observed source set.
- `invoke-source-reconciliation` realizes the accepted operation. Replacement
  uploads and waits for every new source before deleting an old source, then
  re-lists the notebook and settles from the final observed IDs. A stale
  precondition or partial effect closes as a typed refusal with a provider-local
  receipt; it is never reported as a successful replacement.

Dry-run requires no network or source-egress grant, makes no Google call, and
writes no exchange record. Live execution requires the capability to grant
`external-network` for the exact accepted offer. Ephemeral-upload execution
also requires `source-egress`; generation against a successfully reconciled
stable notebook does not egress the same sources a second time.

The current live menu is deliberately honest: `report`, `mind-map`,
`infographic`, `audio`, `video`, `code`, `json`, and `data-table`. A code request uses an ephemeral,
source-grounded notebook and returns a validated `json-code-bundle` containing
receiver-relative file paths, language names, and complete proposed contents.
It does not write those files into a receiver and carries
`assayRequired: true`; testing, review, induction, release, credentials, and
activation remain separate receiving-settlement acts. A `json` request also uses an ephemeral notebook, binds one already-seated `emsenn/schema/*` result class, and is admitted only when the returned `data` member validates against that class. A `data-table` request uses Gemini Notebook's native generator, downloads the CSV, and independently checks exact bytes, UTF-8 CSV syntax, header uniqueness, rectangular shape, size bounds, and formula-like cells. Any Python Gemini Notebook may use internally remains opaque provider provenance; only the validated JSON or CSV product crosses the membrane. Video requests additionally bind
`videoFormat` (`cinematic` or `explainer`), `videoStyle`, and `videoLanguage`;
cinematic requests require English and a null style because Gemini Notebook ignores
styles for that format. Native Gemini Notebook infographics are generated
imagery; they are not deterministic evidence graphics. Deterministic SVG/PNG
report graphics belong to a separate service. Every ephemeral operation writes a cleanup intent as soon as the exact notebook exists. After the local artifact or refusal is seated, it deletes only that notebook and its local upload copies and writes a content-addressed cleanup receipt. A failed cleanup remains an explicit leaked-notebook receipt recoverable from the intent ledger. Other
Gemini Notebook artifact types are not advertised until their output validators and
realizers exist.

Channel identities, curricula, schedules, and publication history live only in `youtube/channels/`. This generic provider retains Gemini Notebook artifact and library operations for independent consumers. It has no channel-specific grants or quota allocations; provider quota failures propagate as failures. Ephemeral video invocations retain a durable intent before generation, and an interrupted invocation requires explicit recovery.

Reconciled-notebook video execution is asynchronous. The first accepted
invocation records a submitting intent, reobserves the exact receipt-bound
source set, submits one non-blocking task, and returns its provider operation
identity. Replaying the exact invocation polls that task; it never generates a
second video. Exact post-commit task recovery uses `artifact list`, and exact
post-download recovery reuses the retained MP4 rather than downloading again.
Completed artifacts expose the validated MP4 payload and exact provider
artifact ID through the ordinary service result.

The downloaded MP4 is transient job input, never delivery authority. After
validating the MP4 container, SHA-256 digest, media type, and length, the
provider retains at most 512 MiB through the existing immutable-content
custody owner backed by Cloudflare R2. The delivery ledger, result, and HMAC
capability bind that immutable reference and its exact payload terms. An
authenticated GET, HEAD, or single-range request reads the reference from R2
and re-verifies the returned bytes; therefore a fresh runtime with no local
artifact file can still deliver the artifact. Missing or changed remote bytes
close as refusals rather than falling back to a local exchange directory.

Artifact generation does not silently reconcile a corpus. A stable notebook is
managed through the separate `gemini-notebook-source-reconciliation` contract:

1. `observe-live` requires only `external-network` and returns the current
   source IDs without mutation.
2. `reconcile-live` requires `external-network`, `source-egress`, and
   `notebook-source-mutation`; its accepted request names the exact observed
   IDs, the digest-bound desired files, and `replace-all-staged` policy.
3. The provider stages and verifies all desired sources, deletes only the
   accepted old IDs, and issues a receipt containing previous, added, deleted,
   and final observations plus cost. A concurrent change causes refusal before
   upload or deletion.

Only regular, non-symlink local files with caller-supplied SHA-256 digests are
currently admitted for replacement. This keeps the egress object exact; URL
contents are not falsely represented as digest-bound merely because their
locator is known. One operation is bounded to 50 unique source identities, 10
MiB per file, 50 MiB total, and the accepted 60–3600 second runtime ceiling.

## Packet attachment

A Leader ActivityStreams `Create<Note>` may attach:

```json
{
  "type": "GeminiNotebookRequest",
  "sources": ["/absolute/or/contract-resolved/source.md"],
  "prompt": "Produce the requested report.",
  "artifactType": "report",
  "executionMode": "dry-run",
  "corpusMode": "ephemeral-upload"
}
```

To request code, use the same packet with `"artifactType": "code"` and keep
`"corpusMode": "ephemeral-upload"`. The provider appends only the JSON carrier
contract to the consumer's preserved prompt, calls Gemini Notebook's source-grounded
chat operation, validates the returned bundle, and seats it as an authored
proposal. Gemini Notebook provider calls and wall time are observed capacity use;
an unpriced quota is not recorded as zero cost.

To request schema-bound JSON, use `"artifactType": "json"`, keep
`"corpusMode": "ephemeral-upload"`, and add
`"resultSchema": "emsenn/schema/<seated-class>"`. To request a native CSV,
use `"artifactType": "data-table"` in ephemeral mode. A JSON artifact can be
content-addressed, copied with a `.txt` upload suffix, and purchased as an
exact source for a later fresh-notebook exchange; each exchange owns and
cleans up its notebook independently.

For live execution, the same activity also carries a `ResourceGrant` whose
`effects` contains `external-network` and `source-egress` and whose runtime cap
is large enough for the accepted provider operation.

After a successful source reconciliation, artifact generation may instead use
the one stable notebook:

```json
{
  "type": "GeminiNotebookRequest",
  "sources": [
    {
      "path": "/receipt-bound/current-union-delta.json",
      "digest": "sha256:...",
      "title": "Current Union delta"
    }
  ],
  "prompt": "Produce a short audio briefing focused on material change.",
  "artifactType": "audio",
  "executionMode": "live",
  "corpusMode": "reconciled-notebook",
  "notebookSourceReceiptId": "urn:sha256:..."
}
```

The provider admits that request only when the named content-addressed receipt
exists in its own append-only ledger, has outcome `reconciled`, and binds the
same desired-source manifest. Immediately before generation, the harness
re-lists the notebook and requires exact equality with the receipt's final,
ready source IDs. A later manual or concurrent source change therefore settles
as refusal rather than generating audio from an unrecorded corpus.

A replacement request is a separate attachment:

```json
{
  "type": "GeminiNotebookSourceReconciliationRequest",
  "notebookId": "the-stable-notebook-id",
  "policy": "replace-all-staged",
  "executionMode": "reconcile-live",
  "expectedCurrentSourceIds": ["the-id-returned-by-observe-live"],
  "desiredSources": [
    {
      "path": "/absolute/path/to/current-union-delta.json",
      "digest": "sha256:...",
      "title": "Current Union delta"
    }
  ],
  "maxRuntimeSeconds": 1800
}
```

## Provider interior

- `src/contract-gemini-notebook.js` owns solicitation, offer formation, capability
  admission, invocation, and provider-local causal witnesses.
- `run-one-exchange.py` owns the Google/`notebooklm-py` boundary and seats one
  artifact-or-refusal exchange record for every live attempt.
- `src/contract-gemini-notebook-sources.js` and
  `reconcile-notebook-sources.py` own the stable-corpus contract and mutation
  boundary. Their live receipts are append-only records under `data/receipts/`.
- `content/contracts/` carries the provider promise.
- `content/exchanges/` carries live provider outcomes. Historical pilot
  artifacts remain readable there as provenance.
- `data/` carries append-only provider solicitation and invocation events.

Authentication remains in the provider's secret manager or
`NOTEBOOKLM_AUTH_JSON`; credentials never enter offers, traces, or exchange
records. The corporate deployment is provider-native and receives its
ActivityPub origin, chain RPC, R2 custody, and Gemini Notebook authentication at
runtime. User-systemd units and `/home/emsenn` paths are not deployment
artifacts. The Python harness remains an ephemeral provider implementation
detail, never a required executable on a customer or developer laptop.

## General workspace market

`apps/serve-gemini-notebook-workspace-market.mjs` projects the
actor-facing workspace market. It is not specific to Codex or
the Union Advisory corpus. Any customer actor may request a provider-authored
workspace offer carrying its own title, 1–300 source ceiling, lease duration,
and ephemeral or persistent retention term. Acceptance binds a customer-owned
budget over provider-native meters: calls, egress bytes, wall time, and scarce
Studio quota. Fixed fee and markup are both absent. These quantities are not
translated into money unless an independent observed-cost oracle supplies a
rate. Live creation additionally crosses the independently sovereign
notebook-creation authorization service; governance authorization is not sold
back to the Union as a retail product.

The same surface compiles digest-bound corpora from regular files, directory
trees, and explicitly authorized Codex session projections. Session projection
includes only user and assistant messages, excludes system/developer/tool/world
state records, rejects credential-shaped contents by default, and emits a
content-addressed text source rather than uploading raw JSONL. Corpus
compilation refuses instead of silently truncating when the purchased source
ceiling is exceeded.

An open lease permits bounded source admission, grounded questions, and
separately purchased Studio lots for every installed CLI generator: audio,
cinematic and ordinary video, data tables, flashcards, infographics, mind maps,
quizzes, reports, and slide decks. Studio products carry no truth, execution,
publication, or governance authority. Exact local JSON/CSV/other carriers can
be condensed into content-addressed K and admitted to a fresh workspace. A
condensate reaches the Union Advisory corpus only through a separate pending
promotion proposal and assay.

Ephemeral cleanup first seats an exact cleanup intent, deletes only the leased
notebook, then re-observes the notebook list. It returns either a confirmed
cleanup receipt or an explicit leak receipt. This generalized lifecycle is
separate from the older 50-source replacement contract, whose smaller bound
continues to govern only that legacy stable-notebook operation.

The digest-pinned Union advisory adapter treats its `SHUOC ADVISORY sha256:*`
sources as temporary computation inputs. A completed advisory or typed refusal
seats local corpus and outcome bytes before deleting its exact source. The
bounded `--cleanup-obsolete` recovery operation retires only adapter-prefixed,
non-current sources whose exact corpus bytes and manifest are already retained
locally; it never sweeps unrelated notebook sources.

## Provider servers

`serve-gemini-notebook-activitypub` exposes the existing ActivityPub/A2A operations,
signed Agent Card, and JWKS. Set `ACTIVITYPUB_ORIGIN`, its signing keys, the
Cloudflare R2 queue/custody configuration, and Gemini Notebook authentication for
the chosen host. `HOST` and `PORT` bind its listener.

`serve-gemini-notebook-artifacts` serves immutable R2 video artifacts on
`GEMINI_NOTEBOOK_ARTIFACT_HOST` and `GEMINI_NOTEBOOK_ARTIFACT_PORT` (default 8082).
The private file named by `GEMINI_NOTEBOOK_ARTIFACT_CAPABILITY_KEY` supplies at
least 32 signing bytes for HMAC bearer capabilities bound to the exact
operation, digest, and length. Configure `GEMINI_NOTEBOOK_ARTIFACT_BASE_URL` to
this listener's HTTPS origin. These servers do not require Cloud Run.

## Direct harness diagnostics

```sh
.venv/bin/python3 run-one-exchange.py path/to/packet.json --dry-run
```

That validates the packet and reports authentication presence without a
network call. Normal consumers should use the advertised contract operations
through LMT rather than calling the harness directly.
# Gemini Notebook inference team

Provider witness records can settle directly on the Semiotic Exchange Chain
(`eip155:5615610`) by setting `SEMIOTIC_EXCHANGE_CHAIN=1` and supplying
`EVM_RPC_URL`, `EVM_KEYSTORE_PATH`, `EVM_KEYSTORE_PASSWORD_PATH`, and
`ONCHAIN_RESOURCE_CONTRACT`. The chain resource membrane is the ActivityPub
service's existing ERC-5219 client; no local WitnessJournal service is required in this
mode. Each witness is stored under a content-addressed resource path and an
on-chain category index supports recovery and idempotent async jobs.

Unset `SEMIOTIC_EXCHANGE_CHAIN` only for explicitly designated legacy fixtures
or deployments; that compatibility path still requires `WITNESS_JOURNAL_RDF_AGENT`.
