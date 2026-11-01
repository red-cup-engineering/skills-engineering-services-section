# Agent Skill Writing Service

This service owns Agent Skills `SKILL.md` projection.
It hires the Markdown file writing service instead of serializing or writing Markdown itself.

```js
import { writeAgentSkill } from "@red-cup-engineering/skills-services-section";

await writeAgentSkill({
  root: "lib/emsenn/content/skills/monitoring",
  name: "monitoring-a-capability-extraction",
  description: "Finds the implementation and consumers of a requested capability before extraction.",
  body: "Inspect executable code and report the exact duplicate implementations.",
});
```
