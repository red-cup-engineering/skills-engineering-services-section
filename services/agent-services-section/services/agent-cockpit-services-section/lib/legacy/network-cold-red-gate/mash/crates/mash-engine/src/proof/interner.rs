//! String ↔ [`TermId`] interning for the substrate.

use super::TermId;
use std::collections::HashMap;

/// A two-way mapping between strings and [`TermId`]s.
///
/// Insertion order is preserved; IDs are assigned sequentially from 0.
/// This makes snapshot/reload deterministic: dumping `by_id` in order
/// and replaying yields identical IDs.
#[derive(Debug, Default)]
pub struct Interner {
    to_id: HashMap<String, TermId>,
    by_id: Vec<String>,
}

impl Interner {
    /// Create an empty interner.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Intern `s`, returning its [`TermId`]. Repeated calls with the same
    /// string return the same id.
    pub fn intern(&mut self, s: &str) -> TermId {
        if let Some(&id) = self.to_id.get(s) {
            return id;
        }
        let id = self.by_id.len() as TermId;
        self.by_id.push(s.to_owned());
        self.to_id.insert(s.to_owned(), id);
        id
    }

    /// Intern a structured triple, returning a stable [`TermId`] that
    /// names the triple `⟨s, p, o⟩`. Used as the object of derivations
    /// that need to distinguish among many (left, right) source pairs
    /// (pair-by-subject composition / fusion / implication) and for
    /// Chu-morphism structured objects in specialization / inversion.
    ///
    /// Nested triples render recursively: `⟨⟨a,b,c⟩,x,⟨d,e,f⟩⟩`.
    pub fn intern_triple(&mut self, s: TermId, p: TermId, o: TermId) -> TermId {
        let s_name = self.name(s).unwrap_or("?").to_owned();
        let p_name = self.name(p).unwrap_or("?").to_owned();
        let o_name = self.name(o).unwrap_or("?").to_owned();
        let repr = format!("⟨{s_name},{p_name},{o_name}⟩");
        self.intern(&repr)
    }

    /// Look up the id of an already-interned string.
    #[must_use]
    pub fn get(&self, s: &str) -> Option<TermId> {
        self.to_id.get(s).copied()
    }

    /// Look up the string for an id.
    #[must_use]
    pub fn name(&self, id: TermId) -> Option<&str> {
        let idx = usize::try_from(id).ok()?;
        self.by_id.get(idx).map(String::as_str)
    }

    /// Number of interned terms.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// True iff no terms have been interned.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}
