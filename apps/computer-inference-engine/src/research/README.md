# Research reports

`ensureResearchReport` writes a Markdown research report, its admitted source list, and a resumable draft beside a caller-selected `reportPath`. It runs through the inference provider runtime and requests live web search from the selected provider. The capability has no knowledge of the caller's channel or curriculum.

```js
import { ensureResearchReport } from "@red-cup-engineering/computer-inference-engine/research/report";

const result = await ensureResearchReport({
  reportPath: "content/curricula/example/lessons/topic/report.md",
  prompt: "Research the topic and explain the relevant evidence.",
  provider: "codex",
  model: "gpt-5.5",
  minWords: 2000,
  minSources: 2,
  completedSearches: 0,
  onRecord: async (event) => persistCallerCheckpoint(event),
});
```

The report is admitted only when it meets both size and distinct cited-URL bounds and records at least one completed web search. Existing admitted reports are reused; `preserveSubmitted` defaults to true so a report already used downstream is not replaced. A short existing report is copied to `report.previous.md` before a requested replacement. An incomplete attempt remains in `report.draft.md`, with completed-search counts, supplied search evidence, exchange records, and refusals in `report.draft.sources.json`. A saved draft meeting admission bounds is admitted without another inference call. A deficient draft and its matching evidence checkpoint are archived as `report.draft.previous.md` and `report.draft.previous.sources.json`; the next invocation makes one fresh web-search-enabled revision attempt. Each invocation makes at most one provider exchange, and failed revisions are archived on the following invocation. A checkpoint whose digest no longer matches its draft remains a hard block. The final source metadata is `report.sources.json`.

`ResearchBlocked` carries a `status` describing provider refusal, provider error, or insufficient report evidence. Callers can inject `runExchange` for alternate transports or deterministic execution. Source count and completed-search count are admission evidence only; they do not claim that every cited statement has been independently verified.

`citedUrls(markdown)` returns distinct, syntactically valid HTTP(S) URLs found in a report. Consumers can use it when building metadata tied to report content.
