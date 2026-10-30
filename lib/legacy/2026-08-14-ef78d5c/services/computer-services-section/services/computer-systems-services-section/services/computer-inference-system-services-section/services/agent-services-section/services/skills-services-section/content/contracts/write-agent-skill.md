# Write an agent skill

The service accepts a root, one directory name, an Agent Skills name and description, a nonempty Markdown body, and an explicit Markdown write mode.
It validates the skill and directory names as lowercase kebab-case path segments.
It projects exactly the `name` and `description` frontmatter keys admitted by the Agent Skills format.
It hires the Markdown file writing service for normalization, path admission, current-state reading, and atomic persistence.
It does not implement Markdown normalization or filesystem writes.
