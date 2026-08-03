//! LLM — vocabulary and tool-schema projection for LLM effectors.
//!
//! # Scope
//!
//! The **LLM effector** itself (spawning `claude -p <prompt>`,
//! capturing JSON output, witnessing completion metrics) is
//! subprocess-binary work and lives outside the library.
//!
//! What this module provides:
//!
//! - **Vocabulary** — LLM-specific predicates for completion output
//!   and provider metrics: [`PRODUCED_COMPLETION`],
//!   [`HAS_LLM_SESSION`], [`HAS_TURN_COUNT`].
//! - **Tool-schema projection** — [`ToolSchemaPort`] watches each
//!   session's [`crate::command::HAS_AVAILABLE_COMMAND`] and the
//!   per-command metadata ([`crate::command::HAS_VERB_NAME`],
//!   [`crate::command::HAS_COMMAND_DESCRIPTION`],
//!   [`crate::command::HAS_USAGE`]) and emits a composed
//!   [`HAS_TOOL_SCHEMA`] text per session. An LLM effector reads
//!   this cell and injects it into the session's prompt context.
//!
//! # Tool-schema format
//!
//! The default composition is a simple plain-text listing:
//!
//! ```text
//! Available commands:
//! - look [target] — Describe your surroundings, or a named target.
//! - go <direction> — Move in a direction.
//! ...
//! ```
//!
//! Deployments that want structured JSON / OpenAPI / MCP tool
//! descriptors should wrap this port with a transformer or implement
//! their own using the same subscription shape.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::command::{
    HAS_AVAILABLE_COMMAND, HAS_COMMAND_DESCRIPTION, HAS_USAGE, HAS_VERB_NAME,
};

// ─────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────

/// `(op, produced-completion, text-or-blob-ref)` — the LLM op's
/// completion output.
pub const PRODUCED_COMPLETION: &str = "produced-completion";

/// `(op, has-llm-session, provider-session-id)` — provider-side
/// session identifier (e.g. for `claude --resume <sid>`). Gives a
/// future persistent-conversation port the handle to chain turns.
pub const HAS_LLM_SESSION: &str = "has-llm-session";

/// `(op, has-turn-count, decimal-string)` — number of turns the
/// provider reports the completion took.
pub const HAS_TURN_COUNT: &str = "has-turn-count";

/// `(session, has-tool-schema, text)` — composed tool-schema text
/// the LLM effector injects into prompt context. Multi-valued as
/// the cache updates; consumers read the latest.
pub const HAS_TOOL_SCHEMA: &str = "has-tool-schema";

// ─────────────────────────────────────────────────────────────────────
// Tool-schema projection
// ─────────────────────────────────────────────────────────────────────

/// Per-command metadata accumulated from vocabulary claims.
#[derive(Debug, Clone, Default)]
struct CommandMeta {
    verb: Option<String>,
    description: Option<String>,
    usage: Option<String>,
}

/// Tool-schema composition projection.
pub struct ToolSchemaPort {
    /// session → set of available commands.
    session_commands: HashMap<String, BTreeSet<String>>,
    /// command → metadata.
    command_meta: HashMap<String, CommandMeta>,
    /// Last-emitted schema per session (dedup).
    last_emitted: HashMap<String, String>,
}

impl Default for ToolSchemaPort {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolSchemaPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            session_commands: HashMap::new(),
            command_meta: HashMap::new(),
            last_emitted: HashMap::new(),
        }
    }

    fn compose_for_session(&self, session: &str) -> Option<String> {
        let commands = self.session_commands.get(session)?;
        if commands.is_empty() {
            return None;
        }
        let mut lines = vec!["Available commands:".to_owned()];
        // Deterministic order by verb then command subject.
        let mut entries: BTreeMap<String, String> = BTreeMap::new();
        for cmd in commands {
            let meta = self.command_meta.get(cmd).cloned().unwrap_or_default();
            let verb = meta.verb.clone().unwrap_or_else(|| cmd.clone());
            let usage = meta.usage.unwrap_or_else(|| verb.clone());
            let description = meta.description.unwrap_or_default();
            let line = if description.is_empty() {
                format!("- {usage}")
            } else {
                format!("- {usage} — {description}")
            };
            entries.insert(verb, line);
        }
        for (_, line) in entries {
            lines.push(line);
        }
        Some(lines.join("\n"))
    }

    fn refresh_session(&mut self, session: &str) -> Vec<Claim> {
        let Some(schema) = self.compose_for_session(session) else {
            return Vec::new();
        };
        if self.last_emitted.get(session).map(String::as_str) == Some(schema.as_str()) {
            return Vec::new();
        }
        self.last_emitted
            .insert(session.to_owned(), schema.clone());
        vec![Claim::new(session, HAS_TOOL_SCHEMA, &schema)]
    }

    fn refresh_sessions_referencing_command(&mut self, command: &str) -> Vec<Claim> {
        let sessions: Vec<String> = self
            .session_commands
            .iter()
            .filter(|(_, set)| set.contains(command))
            .map(|(s, _)| s.clone())
            .collect();
        let mut out = Vec::new();
        for s in sessions {
            out.extend(self.refresh_session(&s));
        }
        out
    }
}

impl Projection for ToolSchemaPort {
    fn identity(&self) -> &str {
        "mash-library-tool-schema"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_AVAILABLE_COMMAND.to_owned(),
            HAS_VERB_NAME.to_owned(),
            HAS_COMMAND_DESCRIPTION.to_owned(),
            HAS_USAGE.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }
        if predicate == HAS_AVAILABLE_COMMAND {
            // (session, has-available-command, command)
            self.session_commands
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
            return self.refresh_session(subject);
        }
        if predicate == HAS_VERB_NAME {
            let entry = self
                .command_meta
                .entry(subject.to_owned())
                .or_default();
            entry.verb = Some(object.to_owned());
            return self.refresh_sessions_referencing_command(subject);
        }
        if predicate == HAS_COMMAND_DESCRIPTION {
            let entry = self
                .command_meta
                .entry(subject.to_owned())
                .or_default();
            entry.description = Some(object.to_owned());
            return self.refresh_sessions_referencing_command(subject);
        }
        if predicate == HAS_USAGE {
            let entry = self
                .command_meta
                .entry(subject.to_owned())
                .or_default();
            entry.usage = Some(object.to_owned());
            return self.refresh_sessions_referencing_command(subject);
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_composes_from_available_commands_with_metadata() {
        let mut port = ToolSchemaPort::new();
        // Mount look + go.
        let _ = port.ingest("cmd:look", HAS_VERB_NAME, "look", Value::True);
        let _ = port.ingest("cmd:look", HAS_USAGE, "look [target]", Value::True);
        let _ = port.ingest(
            "cmd:look",
            HAS_COMMAND_DESCRIPTION,
            "Describe your surroundings.",
            Value::True,
        );
        let _ = port.ingest("cmd:go", HAS_VERB_NAME, "go", Value::True);
        let _ = port.ingest("cmd:go", HAS_USAGE, "go <direction>", Value::True);
        let _ = port.ingest(
            "cmd:go",
            HAS_COMMAND_DESCRIPTION,
            "Move in a direction.",
            Value::True,
        );
        // Make both available to session:1.
        let _ = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:look", Value::True);
        let out = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:go", Value::True);
        let schema = out
            .iter()
            .find(|c| c.predicate == HAS_TOOL_SCHEMA)
            .expect("should emit tool-schema")
            .object
            .clone();
        assert!(schema.contains("Available commands:"));
        assert!(schema.contains("- go <direction> — Move in a direction."));
        assert!(schema.contains("- look [target] — Describe your surroundings."));
    }

    #[test]
    fn schema_updates_when_metadata_arrives_late() {
        let mut port = ToolSchemaPort::new();
        // Available command arrives before metadata.
        let _ = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:look", Value::True);
        // Metadata arrives later; should trigger schema refresh.
        let _ = port.ingest("cmd:look", HAS_VERB_NAME, "look", Value::True);
        let _ = port.ingest("cmd:look", HAS_USAGE, "look [target]", Value::True);
        let out = port.ingest(
            "cmd:look",
            HAS_COMMAND_DESCRIPTION,
            "Observe.",
            Value::True,
        );
        assert!(out.iter().any(|c| c.predicate == HAS_TOOL_SCHEMA
            && c.object.contains("look [target] — Observe.")));
    }

    #[test]
    fn schema_is_deduplicated() {
        let mut port = ToolSchemaPort::new();
        let _ = port.ingest("cmd:look", HAS_VERB_NAME, "look", Value::True);
        let _ = port.ingest("cmd:look", HAS_USAGE, "look", Value::True);
        let first = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:look", Value::True);
        assert!(!first.is_empty());
        // Re-witness same available-command — no schema change, no
        // re-emission.
        let again = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:look", Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn different_sessions_get_distinct_schemas() {
        let mut port = ToolSchemaPort::new();
        let _ = port.ingest("cmd:look", HAS_VERB_NAME, "look", Value::True);
        let _ = port.ingest("cmd:look", HAS_USAGE, "look", Value::True);
        let _ = port.ingest("cmd:say", HAS_VERB_NAME, "say", Value::True);
        let _ = port.ingest("cmd:say", HAS_USAGE, "say <body>", Value::True);
        let out_a = port.ingest("session:a", HAS_AVAILABLE_COMMAND, "cmd:look", Value::True);
        let out_b = port.ingest("session:b", HAS_AVAILABLE_COMMAND, "cmd:say", Value::True);
        let schema_a = out_a
            .iter()
            .find(|c| c.predicate == HAS_TOOL_SCHEMA)
            .unwrap();
        let schema_b = out_b
            .iter()
            .find(|c| c.predicate == HAS_TOOL_SCHEMA)
            .unwrap();
        assert_eq!(schema_a.subject, "session:a");
        assert_eq!(schema_b.subject, "session:b");
        assert!(schema_a.object.contains("look"));
        assert!(schema_b.object.contains("say"));
        assert!(!schema_a.object.contains("say"));
    }

    #[test]
    fn command_without_description_still_renders() {
        let mut port = ToolSchemaPort::new();
        let _ = port.ingest("cmd:who", HAS_VERB_NAME, "who", Value::True);
        let _ = port.ingest("cmd:who", HAS_USAGE, "who", Value::True);
        let out = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:who", Value::True);
        let schema = out
            .iter()
            .find(|c| c.predicate == HAS_TOOL_SCHEMA)
            .unwrap()
            .object
            .clone();
        assert!(schema.contains("- who"));
        assert!(!schema.contains(" — "));
    }

    #[test]
    fn empty_session_emits_nothing() {
        let mut port = ToolSchemaPort::new();
        // Never witnesses HAS_AVAILABLE_COMMAND; session_commands
        // empty; no schema.
        let out = port.ingest("cmd:look", HAS_VERB_NAME, "look", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn non_true_values_ignored() {
        let mut port = ToolSchemaPort::new();
        let out = port.ingest("session:1", HAS_AVAILABLE_COMMAND, "cmd:look", Value::False);
        assert!(out.is_empty());
    }
}
