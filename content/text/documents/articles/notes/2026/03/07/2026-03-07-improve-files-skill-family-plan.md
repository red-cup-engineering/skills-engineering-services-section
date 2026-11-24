---
title: "Improve-files skill family"
date-created: 2026-03-07T00:00:00
authors:
  - claude
type: text
keywords:
  - Planning
  - ProgressiveAutomation
  - ContentQuality
status: draft
priority: high
depends-on: [15]
goal: "003"
description: "Build a family of file-improvement skills grounded in a formal, computable quality score."
specialization: text
tags:
  - Planning
  - ProgressiveAutomation
  - ContentQuality
---

## Problem

The repository has thousands of files at varying levels of completeness.
Some have rich frontmatter, typed relations, and well-structured body
content. Others have no frontmatter at all. Currently, quality
assessment is qualitative (the assess-page skill produces prose
reports) and improvement is ad-hoc. There is no way to answer "what is
the weakest file in this directory?" computationally, and no systematic
way to improve files from weakest to strongest.

## Goal

A computable file quality score and a family of skills that use it to
find and improve files, starting with the weakest.

## Design

### File quality score

Quality is relational (see `general/terms/quality.md`): a file's
quality emerges from its relations to the rest of the repository.
The score measures observable relations across dimensions:

**Dimension 1: Frontmatter completeness** (0-7 points, mechanical)
- title present: +1
- date-created present: +1
- type present and valid: +1
- tags present (3-5, CamelCase): +1
- description present: +1
- authors present: +1
- at least one semantic relation field (defines, cites, requires,
  teaches, part-of, extends, questions, addresses): +1

**Dimension 2: Body structure** (0-4 points, mechanical)
- has non-empty body content: +1
- has at least one heading: +1
- has at least one markdown link: +1
- has no wikilinks (all resolved): +1

**Dimension 3: Integration** (0-3 points, requires index)
- has at least one incoming link (another file links to this): +1
- has at least 3 outgoing links: +1
- is in a directory with an index.md: +1

**Total: 0-14 points.**

A file scoring 0-3 is "weak." 4-7 is "developing." 8-11 is
"established." 12-14 is "strong." These names are descriptive, not
evaluative — they describe the file's observable relational density.

### The skill family

The improvement skills form a constellation:

| Skill | Scope | Description |
|---|---|---|
| `score-file` | single file | Compute quality score |
| `score-directory` | directory | Score all files, report distribution |
| `improve-weakest-file` | directory (optional) | Find lowest-scoring file, apply applicable improvements |
| `improve-file` | single file | Apply all applicable improvements to one file |
| `infer-description` | single file | Generate description from body content via local model |
| `infer-tags` | single file | Generate tags from body content via local model |
| `infer-type` | single file | Classify file type from content via local model |

Each improvement skill is a leaf operation. `improve-file` composes
them. `improve-weakest-file` selects a file and delegates to
`improve-file`.

### Progressive automation (policy 001)

The quality score is entirely mechanical — a script can compute it
with no inference. The improvement operations split into:
- **Mechanical** (script): add missing date-created from git, fix
  deprecated fields (already in enrich-triage.py)
- **Delegable** (local model): infer description, tags, type from
  content (infer-triage-frontmatter.py does this for triage)
- **Inference** (Claude): semantic relation fields, body improvements,
  integration improvements

The score script is the foundation. It tells the agent what to do
without the agent having to read every file.

## Phases

### Phase 1: Score infrastructure
- [ ] Write `file-quality-score` concept (formal definition)
- [ ] Build `scripts/score-file.py` — compute score for one file or
  directory, output JSON
- [ ] Add `score_files` tool to MCP server (wraps the script)

### Phase 2: Leaf improvement skills
- [ ] Build `infer-description` skill (local model, text-forming)
- [ ] Build `infer-tags` skill (local model, text-forming)
- [ ] Build `infer-type` skill (local model, text-forming)
- [ ] Generalize `infer-triage-frontmatter.py` to work on any file,
  not just triage files

### Phase 3: Composition skills
- [ ] Build `improve-file` skill (runs applicable leaf improvements)
- [ ] Build `improve-weakest-file` skill (score → select → improve)
- [ ] Build `score-directory` / `improve-directory` skills

### Phase 4: Integration
- [ ] Hook into interpret-message: each turn, run one improvement
  on the weakest file in the current working directory
- [ ] Add quality score to triage index for sortable views

## Done when

- `score-file.py` can score any .md file in the repo and output JSON
- `improve-weakest-file` can find and improve the weakest file in a
  given directory without human guidance
- Quality scores are available via MCP tool
- At least one inference-based improvement (description, tags, or type)
  works end-to-end via local model delegation
