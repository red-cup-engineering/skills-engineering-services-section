# Owner steps — "561 Group Game Engineering Notebook"

Everything mechanical is done. What's left needs you at a real browser with your
Google login, because Gemini Notebook has no public API — this repo drives it by
replaying your browser session's cookies through the unofficial `notebooklm-py`
client. Nothing below can be automated further from this machine without that.

Manifest: `content/config/561-group-game-engineering-notebook-corpus.v1.json`
(46 curated sources, sourceCeiling 300, `urn:ame:561-group-game-engineering-notebook`)

Staged, upload-ready corpus (already run through the real `compileCorpus()`
in `src/workspace-market.mjs` — digest-verified, secret-pattern-scanned, header-stamped):
`content/staging/561-group-game-engineering-notebook/corpus/d8c7ade016be560f5fa69c45b299eb140f92b6c1aa713178f55932356571a8ba/`
— 46 numbered `.txt` files + `corpus.json` receipt (sourceSetDigest
`sha256:2d8099ac14bb3a0489a8aa8ca890176f11ee735de9c25bb1c2dd95c90857658d`).

Local bookkeeping already executed for real (no Google touched, isolated
records under `content/staging/561-group-game-engineering-notebook/lease-attempt/`
and `.../receipts/`) — resource-budget authorization, workspace quote (300
sources / 720h lease / persistent), and offer acceptance all completed. The
next step, `openWorkspace` (actual Google notebook creation), was attempted
and refused — confirmed cleanly, not guessed: `create-notebook.mjs` requires
`verifyNotebookCreationAuthorization()` to succeed against
`NOTEBOOK_CREATION_AUTHORIZATION_AGENT` *before it ever calls the Python CLI*,
and every implementation of that authorization service lives only under
read-only `lib/legacy/2026-08-*` trees. There is currently no live authorization
service to call. This is the one structural wall; everything else below is
just "you, at a browser, once."

## 1. Capture a Gemini Notebook session (owner, in a real browser)

Sign into `notebook.google.com` as the account that should own this
notebook, then export that session as a Playwright-shaped storage-state JSON
(`{"cookies": [...]}`) — however `notebooklm-py`'s own `auth`/login flow does
this; it isn't vendored in this repo, so this step happens outside it.

```
export NOTEBOOKLM_AUTH_JSON="$(cat storage-state.json)"
```

## 2. Install the unofficial client (one-time, needs PyPI access)

```
cd .../gemini-notebook-services-section
python3 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements.lock
.venv/bin/python3 -m notebooklm auth check --json          # presence only, no network
.venv/bin/python3 -m notebooklm auth check --test --json   # deliberate real network check
```

## 3. Resolve the authorization wall, then create the notebook

Either (a) stand up a live `notebook-creation-authorization-service` that
`notebook-creation-authorization-client.mjs` can reach and grant it a
one-use, nondelegable authorization for this exact title/customer/provider
— that's a design decision outside this task's mechanical scope — or (b), as
the repo's own README acknowledges is how the two existing notebooks were
actually created, bypass this provider's ceremony and call the client directly:

```
.venv/bin/python3 -m notebooklm create "561 Group Game Engineering Notebook" --json
```

Take the returned `notebook.id` (a UUID) — you'll need it below.

## 4. Upload the 46 staged sources

The staged `.txt` files are already exactly what `addCorpus()` would feed the
CLI one at a time (curated-cumulative-add: never bulk, never delete). Either
let the pipeline do it once a real lease/notebookId exists, or drive the CLI
directly per file in the staged corpus directory:

```
for f in content/staging/561-group-game-engineering-notebook/corpus/d8c7ade.../0*.txt; do
  title=$(sed -n '3p' "$f" | sed 's/^Title: //')
  .venv/bin/python3 -m notebooklm source add "$f" --type file --mime-type text/plain \
    --title "${title:0:180}" --notebook <notebookId> --json
done
```

## 5. Generate the first two reports

Once sources are admitted, request the two reports the task asked for as
Gemini Notebook Studio "report" artifacts (each is `quote_gemini_notebook_studio` →
`generate_gemini_notebook_studio` → `settle_gemini_notebook_studio`, or the CLI's
`generate report ... --notebook <notebookId>` directly):

1. **"State of the 561 game fleet: engineering patterns and gaps"** —
   instructions: synthesize across the four game services' README/ARCHITECTURE/
   DESIGN sources, the fleet-spec-coverage-and-roadmap audit, and the house
   specification standard; name shared engineering patterns across
   flickering-delve/onestone/lantern/solitaire and where the fleet spec
   coverage audit says a service falls short of house standard.
2. **"The house mathematics as game mechanics: what the corpus supports"** —
   instructions: read the @red-cup-engineering/metrologic submodule READMEs (bilattice,
   closure, obstruction, hyperdoctrine, chu, etc.) together with the
   predicated-work theory notes (decomposition patterns, regime
   classification, capacity, abandonment) and the Girard/Caillois ludics note,
   and state concretely which formal structures already have a plausible
   reading as game mechanics (turn/regime structure, resource capacity,
   quest/objective decomposition, save-and-resume) versus which are still
   open questions in the source material itself.

## What actually happened vs. what's still yours to do

| Step | Status |
|---|---|
| Curate 46-file corpus, write versioned manifest | done |
| Run real `compileCorpus()` — digest, scan, project to `.txt` | done (mechanical, no network) |
| `authorizeResourceBudget` → `quoteWorkspace` → `acceptWorkspaceOffer` | done (mechanical, no network) |
| `openWorkspace` (create the real Google notebook) | refused — no live authorization service |
| Upload sources, generate the two reports | **awaits you**: browser login → venv+client install → resolve/bypass authorization → create → upload → generate |
