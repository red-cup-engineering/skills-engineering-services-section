---
name: analyzing
description: "Diagnose a repository or system condition from bounded current evidence, including when a user asks what is broken, why behavior occurs, or what an unfamiliar formal system means. Use NotebookLM only for source-grounded parsing or modeling; never grant it execution authority or turn the user's explanatory vocabulary into an implementation assignment."
---

# Analyze Codex office knowledge

Analyze is the MAPE-K stage after Monitor has selected current repository
evidence. Its product is a learned, inspectable model of the situation—not a
patch, a command, or a coding recommendation.

1. Start with a bounded Monitor result: exact paths, search terms, observed
   behavior, and any provider receipt. Do not upload an ambient repository or
   unselected transcript.
   When the user supplies a conceptual framing, use it to evaluate evidence;
   do not search every term or literalize examples into proposed components.
2. Choose the smallest useful NotebookLM product:
   - **CSV data table** for inventories, classifications, term-to-record
     mappings, evidence matrices, and cross-face comparisons.
   - **Schema-bound JSON** for a consumer that already has an admitted
     schema.
   - **Python proposal** only as a reproducible parsing/normalization or
     measurement instrument that emits a named JSON/CSV carrier. It is not
     repository code and is never applied to the customer filesystem merely
     because it was generated.
3. Ask for rows or fields that separate: observed fact, source path, inferred
   relation, uncertainty, contradiction, and the next observation capable of
   falsifying the inference. Ask NotebookLM to parse and model; do not ask it
   how to implement a fix.
4. Read the returned artifact against the selected sources. Integrate only
   claims whose evidence path and interpretation settle. Preserve unresolved
   rows as unknowns rather than converting them into a narrative certainty.
5. Emit AnalysisK as: `observations`, `model`, `contradictions`,
   `falsifiable hypotheses`, `unknowns`, and `planning questions`. Its last
   field names what Plan must decide or what Monitor must observe next.

NotebookLM is an Analyze supplier. Its fluent prose, generated Python, JSON,
or CSV does not carry authority to Execute. A provider refusal is a Monitor
outcome; continue from deterministic evidence if the repair seam is already
settled.

Never send raw credentials or treat fluent output as primary repository
evidence. Codex may execute from repository evidence and Leader authority
without an advisory artifact when the next act is already settled.
