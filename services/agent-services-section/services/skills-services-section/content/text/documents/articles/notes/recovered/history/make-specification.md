---
description: Create a new specification per the specification-specification normative scaffold
id: make-specification
name: make-specification
version: [0, 1]
type: operational
runtime: script+inference
triggers:
  - "make specification"
  - "create spec"
  - "new specification"
  - "write spec"
  - "scaffold spec"
inputs:
  spec_id: string
  category: string
  source_material: string?
outputs:
  specification: string
  directory: string
region:
  reads: ["content/technology/specifications/"]
  writes: ["content/technology/specifications/"]
dependencies:
  - fix-frontmatter
  - validate-thing
scopes: []
part-of: technology/specifications/specification-specification
---
Create a specification: $ARGUMENTS

## What this skill does

Creates a new specification by:
1. Running the scaffold script to generate the directory and template
2. Guiding the agent through filling each TODO section
3. Validating the spec against the normative scaffold

This skill exists to prevent agents from reading
specification-specification each time they write a specification.
The scaffold script encodes the normative scaffold (A.1-A.10) as a
template; this skill encodes the content-filling process.

## Instructions

### 1. Parse arguments

From `$ARGUMENTS`, extract:
- **spec-id**: kebab-case identifier (e.g., `semiotic-citation`)
- **category**: `format` or `convention` (default: convention)
- **source material**: paths to triage files or existing docs that
  inform the spec's content

### 2. Run the scaffold script

```bash
cd content
python technology/specifications/specification-specification/scripts/scaffold-specification.py \
  SPEC_ID --category CATEGORY
```

This creates `technology/specifications/SPEC_ID/index.md` with all
sections from the specification-specification normative scaffold
(A.1-A.10) pre-filled as TODO markers. Convention specs omit A.2,
A.7, A.9 per specification-specification §0.

### 3. Read source material

If source material paths were provided, read each file. Extract:
- Key concepts and vocabulary
- Existing practices being codified
- Normative constraints already in use
- Terms that need glossary entries

Do NOT copy source material into the spec. The spec defines normative
rules; source material provides context for what those rules should be.

### 4. Fill the specification

Open the scaffolded `index.md` and replace each TODO section:

**§0 Scope**: What does this spec apply to? Name directories, file
types, practices, or actors. One paragraph.

**§1 What X is**: Define the core concept in 2-4 paragraphs. What is
it? Why does it exist? What problem does it solve?

**§2+ Normative sections**: The main content. Rules for how things
work. Follow these patterns:
- Number every rule
- Use MUST/SHOULD/MAY per RFC 2119
- Prefer tables for structured information
- Prefer lists for sequential procedures
- One concept per section
- Each rule should be independently testable

**Glossary**: Define every term used normatively. Bulleted list.

**Rationale**: Why these rules? What practice does this codify?
Non-normative, concise.

**Relationship to other specs**: What does this spec require, extend,
or relate to?

### 5. Validate

After filling, check the spec against specification-specification
A.1-A.10:
- [ ] A.1: Frontmatter has spec-id, version, stability
- [ ] A.3: Error semantics defined (classes, schema)
- [ ] A.4: Conformance matrix maps each MUST/SHOULD/MAY to actors
- [ ] A.6: Security considerations addressed (format) or noted
- [ ] A.10: Glossary defines normative terms; rationale exists;
      all examples marked normative or informative
- [ ] Scope section declares format or convention
- [ ] Opening paragraph states what the spec is
- [ ] (Format only) A.2: CANON(x) defined; A.7: determinism stated;
      A.9: formal artifacts provided

### 6. Register

If the specification belongs to a larger system that maintains a
registry or dependency map, update those registrations. The specifics
depend on the context in which the specification is being created.

### 7. Report

State:
- The spec-id and title
- The file path
- How many normative sections were written
- What source material was used
- What registration was done
