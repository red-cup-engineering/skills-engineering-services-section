/**
 * @emsenn/organizing-with-claude-code-cli - organizing with the Claude Code CLI.
 *
 * This package drives the `claude` binary itself - interactive-style sessions and
 * `claude -p`/--print - NOT the Anthropic API. It is the executable, session, and
 * harness-composition layer over the @emsenn/organizing-with-claude topology:
 *
 *   exec        - pure argv builder + the spawn driver over `claude`
 *   events      - project `claude --output-format json|stream-json` into the
 *                 relational trace vocabulary (findings/work/cost)
 *   transcripts - read the sessions claude persists under ~/.claude/projects
 *   harness     - compose context injection, MCP wiring, and hooks into a session,
 *                 settled onto the cli-harness diamond floor (hub-agnostic)
 *   session     - the coding-agent session computer (capsule/finding/impact/
 *                 recall/trace) over @emsenn/organizing-with-claude/session
 *
 * Strictly upstream of the 561 Group Operations Manifold: the manifold consumes
 * this library; this library never imports or assumes it.
 */
export * from "./exec.mjs";
export * from "./events.mjs";
export * from "./transcripts.mjs";
export * from "./harness.mjs";
export * as session from "./session/index.mjs";
