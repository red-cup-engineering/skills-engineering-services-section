---
description: Derives the canonical kebab-case name for a skill or spec file by applying four inference rules (output, identity, judgment, compound) and checking against CANNOT constraints. Use before naming any new skill or spec file.
name: naming
metadata:
  skill-closure-kind: derivation
---

# naming

Given: `unit` — a unit of work or mathematical object that needs a name.

Inference rules (apply in order; use the first that fires):

1. **Output rule.** If the unit produces a named artifact or transformed state: the name IS that artifact or state. Express as a noun or verb+noun compound in kebab-case. (`write-spec-file`, `classified-claims`, `reformed-unit`)

2. **Identity rule.** If the unit IS a thing with structure (not defined by what it does): the name IS the thing itself. Express as a noun. (`name`, `spec`, `nucleus`)

3. **Judgment rule.** If the unit produces a judgment (a classification or assessment): the name IS the judgment type. Express as a noun phrase that names what kind of judgment. (`critique`, `spec-review`, `claim-classification`)

4. **Compound rule.** If the name would be ambiguous within its namespace without qualification: add the minimal qualifying prefix that makes it unique. (`classify-spec-claims`, not `classify-claims` if `claims` is already taken)

Apply each rule: check the candidate name against the namespace (`skills/` or `spec/`) for uniqueness. If a collision exists, apply the compound rule to the first candidate that collided.

Output: `canonical_name` — a kebab-case string, globally unique within its namespace, naming the unit by what it produces or is.

**Check against CANNOT (§name) before accepting:**
- Rejects names that describe a feeling or vibe (`sharpen-`, `improve-`, `enhance-`)
- Rejects names that describe a mid-process action (`run-`, `apply-`, `check-`)
- Rejects names that use numbering (`step-3`, `pass-2`)

If the candidate fails any check: return to rule 1 and reframe from the output's perspective, not the process's.
