---
date-created: 2026-03-31
serves: composable-writing-guide
specialization: analysis
title: Composable writing guide — original architecture, step breakdown, superseded by per-domain skill pattern
---
# Composable Writing Guide

## Problem

Writing guidance currently lives in four monolithic skill files (`writing-terms`, `writing-texts`, `writing-markdown`, `writing-frontmatter`) plus `content-conventions.md`.
These are:

- **Duplicative** — voice rules, frontmatter patterns, and style rules repeat across files
- **Static** — can't vary by domain (math terms need different guidance than sociology terms)
- **Disconnected from the library** — the repo has 260+ files in `library/domains/humanities/domains/writing/` covering voice, style, rhetoric, audience analysis, etc., but the skills don't reference any of it

## Goal

A script like:

```
./produce-writing-guide.py --type term --domain math
```

That outputs a complete, composed writing guide by pulling from: 1.
**Base layers** — shared rules (markdown conventions, frontmatter schema, linking rules) 2.
**Type layers** — type-specific structure (term vs text vs lesson vs essay) 3.
**Domain layers** — domain-specific conventions (math uses formal definitions; sociology uses relational framing) 4.
**Library content** — relevant terms from the writing domain (voice, style, audience, etc.)

## Architecture

```
operations/engineering/fars/produce-writing-guide.py   # the assembler script
operations/engineering/config/writing/                   # config fragments
  base.md                                                # shared: markdown, linking, style
  frontmatter.md                                         # frontmatter schema & rules
  types/
    term-simple.md
    term-formal.md
    term-lesson.md
    text-lesson.md
    text-essay.md
    text-howto.md
  domains/
    default.md                                           # fallback domain guidance
    math.md                                              # formal definitions, LaTeX, proofs
    sociology.md                                         # relational framing, governance
    linguistics.md                                       # semiotics, discourse
    ...
```

The script: 1.
Loads `base.md` + `frontmatter.md` 2.
Loads the matching type fragment from `types/` 3.
Loads the matching domain fragment from `domains/` (falling back to `default.md`) 4.
Optionally pulls relevant terms from `library/domains/humanities/domains/writing/terms/` (e.g., voice.md, style.md, audience.md) 5.
Concatenates with section headers and outputs markdown

## Steps

### Session 1: Extract and decompose

1. **Extract base layer** from current `writing-markdown` and `content-conventions.md` into `config/writing/base.md` — shared markdown, linking, style rules
2. **Extract frontmatter layer** from `writing-frontmatter` into `config/writing/frontmatter.md`
3. **Extract type layers** from `writing-terms` and `writing-texts` — split each type variant (simple term, formal term, lesson, essay, etc.) into its own fragment in `config/writing/types/`
4. **Create domain fragments** — start with `default.md` (current generic voice/approach), then `math.md` from the formal term pattern, and 1-2 others from existing library content

### Session 2: Build the assembler

5. **Write `produce-writing-guide.py`** — Python script that:
   - Accepts `--type` (term-simple, term-formal, text-lesson, text-essay, etc.) and `--domain` (math, sociology, default)
   - Loads and concatenates the right fragments
   - Optionally accepts `--include-library-terms` to pull in relevant writing-domain terms
   - Outputs composed markdown to stdout
6. **Test** with several combinations, compare output against current skill content

### Session 3: Rewire skills and commands

7. **Replace skill SKILL.md files** — each writing skill becomes a thin wrapper that tells Claude to run the script or references the composed output
8. **Update `/write-term` and `/write-text` commands** to use the new system
9. **Update `content-conventions.md`** to reference the composable system instead of duplicating rules
10. **Remove duplicated content** from the old skills once the new system covers it

### Session 4: Expand domain coverage

11. **Audit library writing domain** — identify which of the 260+ writing files contain guidance useful as domain fragments
12. **Create domain fragments** for remaining high-value domains (technical-writing, essay-writing, fiction, etc.)
13. **Document the system** — add a brief README in `config/writing/` explaining how to add new type or domain fragments

## Key decisions to make

- **Fragment format**: plain markdown sections?
  YAML+markdown?
  Pure YAML for structured bits?
- **Library term inclusion**: automatic (based on domain tags) or manual (listed in domain fragments)?
- **Skill integration**: should skills call the script at runtime, or should we pre-generate and cache?
- **Granularity of `--type`**: flat list (term-simple, term-formal) or two flags (`--type term --variant formal`)?

## Success criteria

- `./produce-writing-guide.py --type term-simple --domain math` produces guidance equivalent to current skills but with math-specific additions
- No writing rule appears in more than one source fragment
- Adding a new domain requires only creating one new file in `domains/`
- Existing `/write-term` and `/write-text` workflows still function
