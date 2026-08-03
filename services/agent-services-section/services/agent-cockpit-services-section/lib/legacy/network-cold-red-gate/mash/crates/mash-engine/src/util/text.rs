//! Small text utilities — no domain semantics, no async, no IO.
//!
//! Named functions follow older English usage where possible: the act
//! of joining a list of strings with commas and a terminal conjunction
//! is *quibbling* (OED sense of subdividing a list into equivocally-
//! separated items), and the comma that appears before the conjunction
//! when the list has three or more items is the Oxford comma. The
//! function takes this as the default.

#![warn(missing_docs)]

/// Join a slice of strings into a single phrase using commas and a
/// terminal conjunction, with the Oxford comma on lists of 3+.
///
/// # Examples
///
/// ```
/// use mash_engine::util::text::quibble;
///
/// assert_eq!(quibble(&[] as &[&str], "and"), "");
/// assert_eq!(quibble(&["alice"], "and"), "alice");
/// assert_eq!(quibble(&["alice", "bob"], "and"), "alice and bob");
/// assert_eq!(
///     quibble(&["alice", "bob", "carol"], "and"),
///     "alice, bob, and carol",
/// );
/// assert_eq!(quibble(&["a", "b", "c"], "or"), "a, b, or c");
/// ```
#[must_use]
pub fn quibble<S: AsRef<str>>(items: &[S], conjunction: &str) -> String {
    match items {
        [] => String::new(),
        [only] => only.as_ref().to_owned(),
        [a, b] => format!("{} {} {}", a.as_ref(), conjunction, b.as_ref()),
        _ => {
            let mut s = String::new();
            let last = items.len() - 1;
            for (i, item) in items.iter().enumerate() {
                if i == last {
                    s.push_str(", ");
                    s.push_str(conjunction);
                    s.push(' ');
                } else if i > 0 {
                    s.push_str(", ");
                }
                s.push_str(item.as_ref());
            }
            s
        }
    }
}

/// Select the indefinite article for `noun` — `"a"` before a
/// consonant-initial noun, `"an"` before a vowel-initial one.
///
/// English has irregulars (`"a university"`, `"an hour"`); callers
/// that need those cases can override by asserting
/// `has-starting-phoneme` explicitly in the substrate. This function
/// is the orthography fallback.
///
/// # Examples
///
/// ```
/// use mash_engine::util::text::indefinite_article;
///
/// assert_eq!(indefinite_article("apple"), "an");
/// assert_eq!(indefinite_article("banana"), "a");
/// assert_eq!(indefinite_article("anonymouse"), "an");
/// assert_eq!(indefinite_article(""), "a");
/// ```
#[must_use]
pub fn indefinite_article(noun: &str) -> &'static str {
    match noun.chars().next().map(|c| c.to_ascii_lowercase()) {
        Some('a' | 'e' | 'i' | 'o' | 'u') => "an",
        _ => "a",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quibble_empty() {
        let empty: &[&str] = &[];
        assert_eq!(quibble(empty, "and"), "");
    }

    #[test]
    fn quibble_three_is_oxford_commas() {
        assert_eq!(
            quibble(&["north", "south", "east"], "and"),
            "north, south, and east"
        );
    }

    #[test]
    fn indefinite_article_handles_both_cases() {
        assert_eq!(indefinite_article("Elephant"), "an");
        assert_eq!(indefinite_article("Tiger"), "a");
    }
}
