//! Harness — substrate vocabulary for publishing `.claude/` layouts.
//!
//! # What a harness is
//!
//! A **harness** is an external tooling integration — specifically
//! the `.claude/` directory structure that Claude Code and the
//! Claude Agent SDK consume. Substrate claims declare skills,
//! commands, agents, rules, hooks, settings, and docs; a publisher
//! port writes the corresponding files to disk.
//!
//! This module declares the vocabulary and a typed extraction view
//! ([`HarnessCollector`]). Actual file serialization (YAML
//! frontmatter, JSON hooks, JSON settings) is subprocess-binary
//! work — the library stays off-disk and serde-free.
//!
//! # Layout the publisher emits (reference)
//!
//! | Component subject | Path | Content |
//! |---|---|---|
//! | `harness-skill:<slug>` | `.claude/skills/<slug>/SKILL.md` | YAML frontmatter + markdown body |
//! | `harness-command:<slug>` | `.claude/commands/<slug>.md` | same shape |
//! | `harness-agent:<slug>` | `.claude/agents/<slug>.md` | same shape |
//! | `harness-rule:<slug>` | `.claude/rules/<slug>.md` | same shape |
//! | `harness-hook:<slug>` | `.claude/hooks/<slug>.json` | JSON (matcher, trigger, command) |
//! | `harness-setting:<key>` | merged into `.claude/settings.json` | JSON value |
//! | `harness-doc:<slug>` | project-root path from `has-deploy-path` | markdown body |

use std::collections::{BTreeMap, BTreeSet, HashMap};

use async_trait::async_trait;
use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-harness";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A Claude Code skill. Subject form `harness-skill:<slug>`.
pub const HARNESS_SKILL: &str = "harness-skill";

/// A Claude Code slash-command.
pub const HARNESS_COMMAND: &str = "harness-command";

/// A Claude Code agent.
pub const HARNESS_AGENT: &str = "harness-agent";

/// A Claude Code rule / policy.
pub const HARNESS_RULE: &str = "harness-rule";

/// A Claude Code hook (matcher + trigger + command).
pub const HARNESS_HOOK: &str = "harness-hook";

/// A Claude Code settings key. Subject form
/// `harness-setting:<key>`.
pub const HARNESS_SETTING: &str = "harness-setting";

/// A project-root document deployed via the publisher.
pub const HARNESS_DOC: &str = "harness-doc";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(component, has-name, string)` — display name. Defaults to slug
/// when absent.
pub const HAS_NAME: &str = "has-name";

/// `(component, has-description, string)` — one-line description.
pub const HAS_DESCRIPTION: &str = "has-description";

/// `(component, has-body, markdown-string)` — body text.
pub const HAS_BODY: &str = "has-body";

/// `(component, has-allowed-tool, tool-name)` — multi-valued;
/// emitted sorted into frontmatter `allowed_tools`.
pub const HAS_ALLOWED_TOOL: &str = "has-allowed-tool";

/// `(agent, has-model, model-tier-string)` — agent's model tier.
pub const HAS_MODEL: &str = "has-model";

/// `(skill, has-activation, activation-string)` — skill activation
/// phrase / kind.
pub const HAS_ACTIVATION: &str = "has-activation";

/// `(hook, has-matcher, regex-or-glob)` — hook's matcher.
pub const HAS_MATCHER: &str = "has-matcher";

/// `(hook, has-trigger-event, event-name)` — hook's trigger event.
pub const HAS_TRIGGER_EVENT: &str = "has-trigger-event";

/// `(hook, has-command, shell-string)` — hook's command.
pub const HAS_COMMAND: &str = "has-command";

/// `(setting, has-setting-value, string)` — setting value. Stored
/// as a string; the publisher emits it as a JSON string.
pub const HAS_SETTING_VALUE: &str = "has-setting-value";

/// `(doc, has-deploy-path, path-string)` — relative filesystem path
/// within the project root where the doc should be written.
pub const HAS_DEPLOY_PATH: &str = "has-deploy-path";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the harness vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Harness;

#[async_trait]
impl Agent for Harness {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        for t in [
            HARNESS_SKILL,
            HARNESS_COMMAND,
            HARNESS_AGENT,
            HARNESS_RULE,
            HARNESS_HOOK,
            HARNESS_SETTING,
            HARNESS_DOC,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        for p in [
            HAS_NAME,
            HAS_DESCRIPTION,
            HAS_BODY,
            HAS_ALLOWED_TOOL,
            HAS_MODEL,
            HAS_ACTIVATION,
            HAS_MATCHER,
            HAS_TRIGGER_EVENT,
            HAS_COMMAND,
            HAS_SETTING_VALUE,
            HAS_DEPLOY_PATH,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }
        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Typed component view
// ─────────────────────────────────────────────────────────────────────

/// Typed classification of a harness subject.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HarnessKind {
    /// `.claude/skills/<slug>/SKILL.md`.
    Skill,
    /// `.claude/commands/<slug>.md`.
    Command,
    /// `.claude/agents/<slug>.md`.
    Agent,
    /// `.claude/rules/<slug>.md`.
    Rule,
    /// `.claude/hooks/<slug>.json`.
    Hook,
    /// Merged into `.claude/settings.json`.
    Setting,
    /// Written to the project root at `has-deploy-path`.
    Doc,
}

impl HarnessKind {
    /// Infer from a subject's prefix.
    #[must_use]
    pub fn from_subject(subject: &str) -> Option<Self> {
        let prefix = subject.split(':').next()?;
        match prefix {
            "harness-skill" => Some(Self::Skill),
            "harness-command" => Some(Self::Command),
            "harness-agent" => Some(Self::Agent),
            "harness-rule" => Some(Self::Rule),
            "harness-hook" => Some(Self::Hook),
            "harness-setting" => Some(Self::Setting),
            "harness-doc" => Some(Self::Doc),
            _ => None,
        }
    }

    /// The slug portion of the subject (after the first `:`).
    #[must_use]
    pub fn slug(subject: &str) -> Option<&str> {
        subject.splitn(2, ':').nth(1)
    }
}

/// A fully-resolved harness component's typed contents.
///
/// Subscription ordering is irrelevant — [`HarnessCollector`]
/// accumulates cells for each subject into the appropriate field;
/// producing the [`HarnessComponent`] for a subject is deterministic
/// given its settled claim set.
#[derive(Debug, Clone, Default)]
pub struct HarnessComponent {
    /// `has-name` — falls back to slug if absent.
    pub name: Option<String>,
    /// `has-description`.
    pub description: Option<String>,
    /// `has-body` — markdown body text.
    pub body: Option<String>,
    /// `has-allowed-tool` — multi-valued; stored sorted.
    pub allowed_tools: BTreeSet<String>,
    /// `has-model` — agent-only.
    pub model: Option<String>,
    /// `has-activation` — skill-only.
    pub activation: Option<String>,
    /// `has-matcher` — hook-only.
    pub matcher: Option<String>,
    /// `has-trigger-event` — hook-only.
    pub trigger_event: Option<String>,
    /// `has-command` — hook-only.
    pub command: Option<String>,
    /// `has-setting-value` — setting-only.
    pub setting_value: Option<String>,
    /// `has-deploy-path` — doc-only.
    pub deploy_path: Option<String>,
}

/// Collector projection — accumulates harness cells into typed
/// `(kind, slug) → HarnessComponent` entries.
///
/// Consumers read [`HarnessCollector::components`] to get the current
/// snapshot. The publisher subprocess then serializes each entry to
/// its on-disk shape.
pub struct HarnessCollector {
    // `subject → HarnessComponent`.
    components: HashMap<String, HarnessComponent>,
}

impl Default for HarnessCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl HarnessCollector {
    /// Fresh collector.
    #[must_use]
    pub fn new() -> Self {
        Self {
            components: HashMap::new(),
        }
    }

    /// Snapshot of every accumulated component, grouped by
    /// `(kind, slug)`. Sorted deterministically by kind + slug.
    #[must_use]
    pub fn components(&self) -> BTreeMap<(String, String), HarnessComponent> {
        let mut out: BTreeMap<(String, String), HarnessComponent> = BTreeMap::new();
        for (subject, comp) in &self.components {
            let Some(kind) = HarnessKind::from_subject(subject) else {
                continue;
            };
            let Some(slug) = HarnessKind::slug(subject) else {
                continue;
            };
            let kind_str = format!("{kind:?}");
            out.insert((kind_str, slug.to_owned()), comp.clone());
        }
        out
    }

    /// Retrieve the component for a given subject.
    #[must_use]
    pub fn component_for(&self, subject: &str) -> Option<&HarnessComponent> {
        self.components.get(subject)
    }

    fn apply(&mut self, subject: &str, predicate: &str, object: &str) {
        let entry = self.components.entry(subject.to_owned()).or_default();
        if predicate == HAS_NAME {
            entry.name = Some(object.to_owned());
        } else if predicate == HAS_DESCRIPTION {
            entry.description = Some(object.to_owned());
        } else if predicate == HAS_BODY {
            entry.body = Some(object.to_owned());
        } else if predicate == HAS_ALLOWED_TOOL {
            entry.allowed_tools.insert(object.to_owned());
        } else if predicate == HAS_MODEL {
            entry.model = Some(object.to_owned());
        } else if predicate == HAS_ACTIVATION {
            entry.activation = Some(object.to_owned());
        } else if predicate == HAS_MATCHER {
            entry.matcher = Some(object.to_owned());
        } else if predicate == HAS_TRIGGER_EVENT {
            entry.trigger_event = Some(object.to_owned());
        } else if predicate == HAS_COMMAND {
            entry.command = Some(object.to_owned());
        } else if predicate == HAS_SETTING_VALUE {
            entry.setting_value = Some(object.to_owned());
        } else if predicate == HAS_DEPLOY_PATH {
            entry.deploy_path = Some(object.to_owned());
        }
    }
}

impl Projection for HarnessCollector {
    fn identity(&self) -> &str {
        "mash-library-harness-collector"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_NAME.to_owned(),
            HAS_DESCRIPTION.to_owned(),
            HAS_BODY.to_owned(),
            HAS_ALLOWED_TOOL.to_owned(),
            HAS_MODEL.to_owned(),
            HAS_ACTIVATION.to_owned(),
            HAS_MATCHER.to_owned(),
            HAS_TRIGGER_EVENT.to_owned(),
            HAS_COMMAND.to_owned(),
            HAS_SETTING_VALUE.to_owned(),
            HAS_DEPLOY_PATH.to_owned(),
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
        // Only accumulate for subjects that look like harness
        // components. Other subjects using the same generic
        // predicates (e.g. the command module also has HAS_NAME via
        // grammar) don't belong here.
        if HarnessKind::from_subject(subject).is_none() {
            return Vec::new();
        }
        self.apply(subject, predicate, object);
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_declared() {
        let claims = Harness.claims();
        for t in [
            HARNESS_SKILL,
            HARNESS_COMMAND,
            HARNESS_AGENT,
            HARNESS_RULE,
            HARNESS_HOOK,
            HARNESS_SETTING,
            HARNESS_DOC,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == t && c.predicate == IS_A_TERM),
                "{t} missing"
            );
        }
    }

    #[test]
    fn kind_from_subject_infers_prefix() {
        assert_eq!(
            HarnessKind::from_subject("harness-skill:my-skill"),
            Some(HarnessKind::Skill)
        );
        assert_eq!(
            HarnessKind::from_subject("harness-hook:on-save"),
            Some(HarnessKind::Hook)
        );
        assert_eq!(HarnessKind::from_subject("unrelated:x"), None);
    }

    #[test]
    fn slug_extracts_after_first_colon() {
        assert_eq!(HarnessKind::slug("harness-skill:my-skill"), Some("my-skill"));
        assert_eq!(
            HarnessKind::slug("harness-setting:some-key"),
            Some("some-key")
        );
    }

    #[test]
    fn collector_accumulates_skill_fields() {
        let mut port = HarnessCollector::new();
        let subject = "harness-skill:test";
        let _ = port.ingest(subject, HAS_NAME, "Test Skill", Value::True);
        let _ = port.ingest(subject, HAS_DESCRIPTION, "A skill.", Value::True);
        let _ = port.ingest(subject, HAS_BODY, "body text", Value::True);
        let _ = port.ingest(subject, HAS_ALLOWED_TOOL, "Read", Value::True);
        let _ = port.ingest(subject, HAS_ALLOWED_TOOL, "Edit", Value::True);
        let _ = port.ingest(subject, HAS_ACTIVATION, "keyword", Value::True);
        let c = port.component_for(subject).unwrap();
        assert_eq!(c.name.as_deref(), Some("Test Skill"));
        assert_eq!(c.description.as_deref(), Some("A skill."));
        assert_eq!(c.body.as_deref(), Some("body text"));
        assert_eq!(c.activation.as_deref(), Some("keyword"));
        let tools: Vec<&String> = c.allowed_tools.iter().collect();
        assert_eq!(tools, vec![&"Edit".to_owned(), &"Read".to_owned()]);
    }

    #[test]
    fn collector_accumulates_hook_fields() {
        let mut port = HarnessCollector::new();
        let subject = "harness-hook:on-save";
        let _ = port.ingest(subject, HAS_MATCHER, "**/*.md", Value::True);
        let _ = port.ingest(subject, HAS_TRIGGER_EVENT, "PostToolUse", Value::True);
        let _ = port.ingest(subject, HAS_COMMAND, "format-md {file}", Value::True);
        let c = port.component_for(subject).unwrap();
        assert_eq!(c.matcher.as_deref(), Some("**/*.md"));
        assert_eq!(c.trigger_event.as_deref(), Some("PostToolUse"));
        assert_eq!(c.command.as_deref(), Some("format-md {file}"));
    }

    #[test]
    fn collector_accumulates_doc_deploy_path() {
        let mut port = HarnessCollector::new();
        let subject = "harness-doc:readme";
        let _ = port.ingest(subject, HAS_DEPLOY_PATH, "README.md", Value::True);
        let _ = port.ingest(subject, HAS_BODY, "# Hello", Value::True);
        let c = port.component_for(subject).unwrap();
        assert_eq!(c.deploy_path.as_deref(), Some("README.md"));
        assert_eq!(c.body.as_deref(), Some("# Hello"));
    }

    #[test]
    fn collector_ignores_non_harness_subjects() {
        let mut port = HarnessCollector::new();
        // `has-name` also used by grammar/talker; applied only to
        // harness-prefixed subjects.
        let _ = port.ingest("thing:42", HAS_NAME, "unrelated", Value::True);
        assert!(port.component_for("thing:42").is_none());
    }

    #[test]
    fn snapshot_groups_by_kind_and_slug() {
        let mut port = HarnessCollector::new();
        let _ = port.ingest("harness-skill:a", HAS_NAME, "A", Value::True);
        let _ = port.ingest("harness-command:b", HAS_NAME, "B", Value::True);
        let _ = port.ingest("harness-hook:c", HAS_COMMAND, "true", Value::True);
        let snap = port.components();
        assert!(snap.contains_key(&("Skill".to_owned(), "a".to_owned())));
        assert!(snap.contains_key(&("Command".to_owned(), "b".to_owned())));
        assert!(snap.contains_key(&("Hook".to_owned(), "c".to_owned())));
    }

    #[test]
    fn non_true_values_ignored() {
        let mut port = HarnessCollector::new();
        let _ = port.ingest("harness-skill:a", HAS_NAME, "A", Value::False);
        assert!(port.component_for("harness-skill:a").is_none());
    }
}
