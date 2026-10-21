# Agent skill services

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

An executable JavaScript skill begins as a `TextFileRead`.

1. `read-javascript-file-export-documentation-service` reads standard JSDoc
   attached to exported operations.
2. `read-javascript-file-main-guards-service` reads real
   `if (import.meta.main)` guards.
3. `admit-javascript-operation-skill-source-service` admits the joined reads.
   Free JSDoc prose is the instructional body and one standard `@summary`
   supplies the short discovery description. Private `@skill` declarations
   are refused.
4. `project-agent-skill-markdown-service` purely projects the
   `SKILL.md` file.
5. `project-agent-skill-file-projections-service` purely projects the
   complete, ordered `TextFileCreationProjectionSet` containing
   `<name>/SKILL.md` and the identical executable script.
6. Generic file-projection staging and absent-path publication services write
   that set when a caller explicitly requests materialization.

No skill-specific service scans source text for magic substrings, parses a
second JSDoc dialect, writes directories, overwrites files, or independently
re-renders expected output for comparison.
