# Find Skill Scripts in a Directory Service

Finds every flat file directly inside a directory that carries an `@skill` declaration, by reading each file's text — never by trusting an extension list or a hardcoded pool path.

## Hoare triple

### `findSkillScriptsInADirectory(directory)`

- **Precondition:** `directory` exists on disk.
- **Input:** `directory` — an absolute or relative path, always taken as an argument. The legacy `project-a-skill.js --all` hardcoded `lib/management/skills`, which is why it could never see the Academy's own `lib/professional-repertoire/skills` pool; this service takes the directory explicitly so that bug cannot recur.
- **Output:** an array of absolute paths, sorted, to every regular file directly inside `directory` whose text matches `@skill `.
- **Postcondition:** subdirectories are not descended into. A directory that does not exist raises a clear error rather than returning an empty array — an absent pool and an empty pool are different facts, and only one of them is silence.

```js
import { findSkillScriptsInADirectory } from "@red-cup-engineering/find-skill-scripts-in-a-directory-service";

const scripts = findSkillScriptsInADirectory("lib/professional-repertoire/skills");
```
