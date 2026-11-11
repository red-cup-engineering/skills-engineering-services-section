# Find Skill Scripts in a Directory Service

This Engineering discovery operation identifies **candidate** scripts in the caller's exact directory for the existing `transform-javascript-script-to-skill-service`. It does not author a second script grammar or produce a skill, office, appointment, capability grant, runnable result, or deployment.

The former discovery rule searched for the retired `@skill` magic tag, even though the transformer now **refuses** that declaration. The original two services therefore could not reliably compose. Current discovery calls the original transformer for each flat `.js` or `.mjs` regular file and admits a candidate only if it has a nonempty standard JSDoc `@description`, an accepted declaration vocabulary, and actual instructional prose. Unknown declarations—including `@skill`—are rejected. Non-script files and symlinks are not read.

`findSkillScriptsInADirectory(directory)` continues to return sorted absolute candidate paths, preserving its original output shape. `inspectSkillScriptsInADirectory(directory)` also returns sorted `rejected` records carrying exact paths and reasons; an empty eligible set need not hide a pool full of ineligible scripts. Missing directories and non-directories remain distinct errors. Discovery is deliberately flat: its caller must select the pool; whole-corpus enumeration, incremental revision indexes, cross-section traversal and result pagination belong to their original corpus/registry owners, **not** a recursion switch hidden in this helper.

A candidate still requires the existing source admission and schema validation, actual callable main guard or admitted operation, projection, rights check, publication and independently received use. In particular, the discovery result does not prove a script's JavaScript is executable. The canonical agent-skill pipeline under `skills-engineering-services-section` also supports export-documentation and main-guard admission; use that richer path when projecting exported operations rather than treating this legacy script pool as an exhaustive skill inventory.

## Example

```js
import { inspectSkillScriptsInADirectory } from "@red-cup-engineering/find-skill-scripts-in-a-directory-service";
const { candidates, rejected } = inspectSkillScriptsInADirectory("lib/professional-repertoire/skills");
```

## Receiving conditions

A standard-JSDoc script appears in discovery and can be offered to the original transformer. The same script tagged with retired `@skill`, a missing/empty method, or an unsupported declaration is rejected with a reason. Non-script prose with an incidental `@skill` string is never selected. Pool selection and non-recursion remain intact. A downstream independent admission must separately decide whether each discovered candidate can actually become a usable Agent Skill.

This source change is not evidence of a package release, an updated Group harness, an installed MetroPlat capability, or expansion to thousands of active professional services.
