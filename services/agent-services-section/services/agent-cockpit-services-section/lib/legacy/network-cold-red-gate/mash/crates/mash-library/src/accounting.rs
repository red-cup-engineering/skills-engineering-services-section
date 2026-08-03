//! Accounting — ledger vocabulary and the posting projection.
//!
//! # What this module is
//!
//! Classical double-entry bookkeeping expressed in OQRA: accounts,
//! commodities, and balanced debit/credit/balances transactions.
//! Used by any domain that needs to record a balanced move —
//! compute-cost posting for ops (the [`AccountingPort`] below) and
//! (future) ledger-accurate spatial movement for the MUD.
//!
//! # What a transaction is
//!
//! A transaction is a subject with five required cells:
//!
//! - `(txn, debits, <account>)` — account whose balance decreases
//! - `(txn, credits, <account>)` — account whose balance increases
//! - `(txn, balances, <entity>)` — entity the move is balancing for
//!   (the "mover" — e.g. an op, an avatar)
//! - `(txn, measured-in, <commodity>)` — unit of measure
//! - `(txn, has-amount, <decimal-string>)` — magnitude
//!
//! Debits, credits, and balances land on three different objects
//! off-diagonal from the transaction subject — a transaction's fiber
//! carries the full move as settled claims.
//!
//! # Op-cost posting rule
//!
//! - **Op completed** → `debit expenses:compute:api-cost, credit
//!   income:work:tasks-completed`. Work done produced value; the
//!   cost is an expense against that value.
//! - **Op failed** → `debit expenses:compute:api-cost, credit
//!   liabilities:attention:failures-unreviewed`. Cost was incurred
//!   but no completed work; the credit posts to a liability that's
//!   cleared when a human reviews the failure.
//!
//! Either way the cost is debited as an expense — the substrate
//! always records what was actually spent.
//!
//! # Divergence from old-library
//!
//! `mash-old-library/archive/mash-vocab-accounting` declared
//! `DEBITS INVERTS_AS DEBITED_BY` (and similar for credits /
//! balances / measured-in). Those are converse-positive pairs, not
//! algebraic-negation pairs — under pointwise negation semantics
//! they would propagate incorrectly (witnessing
//! `(acct, debited-by, txn)` True would cascade to
//! `(txn, debits, acct)` False).
//!
//! Per inversion discipline: the reverse predicates are dropped.
//! Reverse queries ("what transactions debit this account?") use
//! fiber scan at the object axis, not a cascading inversion.

use async_trait::async_trait;
use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};
use crate::ops::{HAS_COST_USD, IS_COMPLETED, IS_FAILED};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-accounting";

// ─────────────────────────────────────────────────────────────────────
// Account terms
// ─────────────────────────────────────────────────────────────────────

/// Generic account term.
pub const ACCOUNT: &str = "account";

/// Asset account — balance represents something owned/controlled.
pub const ASSET_ACCOUNT: &str = "asset-account";

/// Liability account — balance represents something owed.
pub const LIABILITY_ACCOUNT: &str = "liability-account";

/// Equity account — balance represents ownership stake.
pub const EQUITY_ACCOUNT: &str = "equity-account";

/// Income account — balance represents earned inflows.
pub const INCOME_ACCOUNT: &str = "income-account";

/// Expense account — balance represents outflows.
pub const EXPENSE_ACCOUNT: &str = "expense-account";

/// A unit of measure.
pub const COMMODITY: &str = "commodity";

/// A balanced ledger entry. Subjects carry debits / credits /
/// balances / measured-in / has-amount cells.
pub const TRANSACTION: &str = "transaction";

// ─────────────────────────────────────────────────────────────────────
// Transaction predicates (each single-direction, no INVERTS_AS)
// ─────────────────────────────────────────────────────────────────────

/// `(txn, debits, account)` — transaction debits this account.
pub const DEBITS: &str = "debits";

/// `(txn, credits, account)` — transaction credits this account.
pub const CREDITS: &str = "credits";

/// `(txn, balances, entity)` — transaction balances the move for
/// this entity (op, avatar, thing).
pub const BALANCES: &str = "balances";

/// `(txn, measured-in, commodity)` — transaction's commodity /
/// unit of measure.
pub const MEASURED_IN: &str = "measured-in";

/// `(txn, has-amount, decimal-string)` — transaction's magnitude.
pub const HAS_AMOUNT: &str = "has-amount";

/// `(txn, recorded-at, iso-timestamp)` — when the transaction was
/// posted (as opposed to when the substrate log receives the event).
pub const RECORDED_AT: &str = "recorded-at";

// ─────────────────────────────────────────────────────────────────────
// Shipping-default account and commodity constants
// ─────────────────────────────────────────────────────────────────────

/// Default expense account every op cost debits to. Production
/// deployments can override via scene-declared account terms.
pub const ACCOUNT_EXPENSES_API: &str = "expenses:compute:api-cost";

/// Default income account credited when an op completes.
pub const ACCOUNT_INCOME_TASKS: &str = "income:work:tasks-completed";

/// Default liability account credited when an op fails — the cost
/// was real but no completed work justifies it; the substrate carries
/// the unreviewed failure as a debt against attention until a human
/// reviews and clears it.
pub const ACCOUNT_LIABILITY_FAILURES: &str = "liabilities:attention:failures-unreviewed";

/// USD commodity subject.
pub const COMMODITY_USD: &str = "commodity:usd";

/// Person commodity subject — unit of measure for avatar/character
/// location accounting. A movement op debits the source room and
/// credits the destination room, balances the avatar, measured in
/// `commodity:person`. Same accounting shape as USD ops, different
/// commodity.
pub const COMMODITY_PERSON: &str = "commodity:person";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the accounting vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Accounting;

#[async_trait]
impl Agent for Accounting {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            ACCOUNT,
            ASSET_ACCOUNT,
            LIABILITY_ACCOUNT,
            EQUITY_ACCOUNT,
            INCOME_ACCOUNT,
            EXPENSE_ACCOUNT,
            COMMODITY,
            TRANSACTION,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        // Every specialized account lifts to ACCOUNT.
        for specialization in [
            ASSET_ACCOUNT,
            LIABILITY_ACCOUNT,
            EQUITY_ACCOUNT,
            INCOME_ACCOUNT,
            EXPENSE_ACCOUNT,
        ] {
            out.push(Claim::new(specialization, SPECIALIZES_AS, ACCOUNT));
        }

        for p in [DEBITS, CREDITS, BALANCES, MEASURED_IN, HAS_AMOUNT, RECORDED_AT] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Transaction composition
// ─────────────────────────────────────────────────────────────────────

/// Terminal phase the op reached when it produced the cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalPhase {
    /// `is-completed` settled.
    Completed,
    /// `is-failed` settled.
    Failed,
}

/// Build the balanced-move claim set for one op + terminal + cost.
///
/// Pure function. `txn_subject` is a caller-minted unique id
/// (convention: `txn:<op>:<iso>`), `amount_usd` is a decimal string,
/// `recorded_at` is an ISO-8601 timestamp.
#[must_use]
pub fn compose_transaction(
    txn_subject: &str,
    op: &str,
    phase: TerminalPhase,
    amount_usd: &str,
    recorded_at: &str,
) -> Vec<Claim> {
    let credit_account = match phase {
        TerminalPhase::Completed => ACCOUNT_INCOME_TASKS,
        TerminalPhase::Failed => ACCOUNT_LIABILITY_FAILURES,
    };
    vec![
        Claim::new(txn_subject, IS_A_TERM, TRANSACTION),
        Claim::new(txn_subject, DEBITS, ACCOUNT_EXPENSES_API),
        Claim::new(txn_subject, CREDITS, credit_account),
        Claim::new(txn_subject, BALANCES, op),
        Claim::new(txn_subject, MEASURED_IN, COMMODITY_USD),
        Claim::new(txn_subject, HAS_AMOUNT, amount_usd),
        Claim::new(txn_subject, RECORDED_AT, recorded_at),
    ]
}

// ─────────────────────────────────────────────────────────────────────
// Posting projection
// ─────────────────────────────────────────────────────────────────────

/// Accounting port. Watches for `(op, is-completed | is-failed, _)`
/// and `(op, has-cost-usd, amount)`, and once both arrive, posts a
/// transaction with [`compose_transaction`].
pub struct AccountingPort {
    terminal: HashMap<String, TerminalPhase>,
    cost: HashMap<String, String>,
    posted: HashSet<String>,
    now_iso: fn() -> String,
}

impl Default for AccountingPort {
    fn default() -> Self {
        Self::with_clock(default_now_iso)
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl AccountingPort {
    /// Fresh state with the default clock.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fresh state with a custom timestamp source — injectable for
    /// deterministic tests.
    #[must_use]
    pub fn with_clock(now_iso: fn() -> String) -> Self {
        Self {
            terminal: HashMap::new(),
            cost: HashMap::new(),
            posted: HashSet::new(),
            now_iso,
        }
    }

    fn try_post(&mut self, op: &str) -> Vec<Claim> {
        if self.posted.contains(op) {
            return Vec::new();
        }
        let Some(phase) = self.terminal.get(op).copied() else {
            return Vec::new();
        };
        let Some(cost) = self.cost.get(op).cloned() else {
            return Vec::new();
        };
        let recorded_at = (self.now_iso)();
        let txn_subject = format!("txn:{op}:{recorded_at}");
        self.posted.insert(op.to_owned());
        compose_transaction(&txn_subject, op, phase, &cost, &recorded_at)
    }
}

impl Projection for AccountingPort {
    fn identity(&self) -> &str {
        "mash-library-accounting-port"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            IS_COMPLETED.to_owned(),
            IS_FAILED.to_owned(),
            HAS_COST_USD.to_owned(),
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
        if predicate == IS_COMPLETED {
            self.terminal
                .insert(subject.to_owned(), TerminalPhase::Completed);
            self.try_post(subject)
        } else if predicate == IS_FAILED {
            self.terminal
                .insert(subject.to_owned(), TerminalPhase::Failed);
            self.try_post(subject)
        } else if predicate == HAS_COST_USD {
            self.cost.insert(subject.to_owned(), object.to_owned());
            self.try_post(subject)
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    fn find_object<'a>(claims: &'a [Claim], subject: &str, predicate: &str) -> Option<&'a str> {
        claims
            .iter()
            .find(|c| c.subject == subject && c.predicate == predicate)
            .map(|c| c.object.as_str())
    }

    #[test]
    fn vocabulary_has_no_inversions() {
        // Inversion discipline: DEBITS/DEBITED_BY etc are converse-
        // positive pairs, not algebraic-negation pairs. Must not
        // declare INVERTS_AS.
        let claims = Accounting.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "accounting module should declare no INVERTS_AS wiring"
        );
    }

    #[test]
    fn account_specializations_cascade_to_account() {
        let claims = Accounting.claims();
        for special in [
            ASSET_ACCOUNT,
            LIABILITY_ACCOUNT,
            EQUITY_ACCOUNT,
            INCOME_ACCOUNT,
            EXPENSE_ACCOUNT,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == special
                    && c.predicate == SPECIALIZES_AS
                    && c.object == ACCOUNT),
                "{special} should specialize-as {ACCOUNT}"
            );
        }
    }

    #[test]
    fn completed_op_credits_income() {
        let claims = compose_transaction(
            "txn:op:t-llm:42",
            "op:t-llm",
            TerminalPhase::Completed,
            "0.012500",
            "2026-04-21T03:00:00Z",
        );
        assert_eq!(
            find_object(&claims, "txn:op:t-llm:42", DEBITS),
            Some(ACCOUNT_EXPENSES_API)
        );
        assert_eq!(
            find_object(&claims, "txn:op:t-llm:42", CREDITS),
            Some(ACCOUNT_INCOME_TASKS)
        );
        assert_eq!(
            find_object(&claims, "txn:op:t-llm:42", BALANCES),
            Some("op:t-llm")
        );
        assert_eq!(
            find_object(&claims, "txn:op:t-llm:42", MEASURED_IN),
            Some(COMMODITY_USD)
        );
        assert_eq!(
            find_object(&claims, "txn:op:t-llm:42", HAS_AMOUNT),
            Some("0.012500")
        );
    }

    #[test]
    fn failed_op_credits_liability() {
        let claims = compose_transaction(
            "txn:op:x",
            "op:x",
            TerminalPhase::Failed,
            "0.001",
            "t",
        );
        assert_eq!(
            find_object(&claims, "txn:op:x", DEBITS),
            Some(ACCOUNT_EXPENSES_API),
            "failure still debits expenses — cost was real"
        );
        assert_eq!(
            find_object(&claims, "txn:op:x", CREDITS),
            Some(ACCOUNT_LIABILITY_FAILURES),
            "failure credits the unreviewed-failures liability"
        );
    }

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn port_posts_once_cost_and_phase_arrive_in_any_order() {
        let mut port = AccountingPort::with_clock(fixed_now);

        // cost first, then phase.
        let noop = port.ingest("op:a", HAS_COST_USD, "0.5", Value::True);
        assert!(noop.is_empty(), "cost alone must not post");

        let posted = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        assert!(
            posted.iter().any(|c| c.predicate == BALANCES && c.object == "op:a"),
            "transaction must balance the op"
        );
    }

    #[test]
    fn port_is_idempotent_per_op() {
        let mut port = AccountingPort::with_clock(fixed_now);
        let _ = port.ingest("op:a", HAS_COST_USD, "0.5", Value::True);
        let first = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        assert!(!first.is_empty());
        let second = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        assert!(second.is_empty(), "must not repost");
    }

    #[test]
    fn port_ignores_non_true_settlements() {
        let mut port = AccountingPort::with_clock(fixed_now);
        let out = port.ingest("op:a", HAS_COST_USD, "0.5", Value::False);
        assert!(out.is_empty());
    }
}
