import Obsmetrologia.Primitive.Mark

/-!
# Utterance — the carrier (no free data)

An **utterance** is the ordered pair of one token and one claim — the two kinds of
mark. It is the **domain** of `Articulating`: the structured carrier the
articulating act is applied to. Token first, claim second; the ordering is
load-bearing.

An utterance is *not* an act — it articulates nothing. It is the pair that
articulating takes as input. Its two-sidedness is exactly what gives articulating's
codomain its four-cell partition.

No free data is introduced here: an utterance is built entirely from two `Mark`s.
-/

namespace Obsmetrologia

/-- The ordered pair of a token-side mark and a claim-side mark. Articulating's
domain. Token first, claim second — the order is load-bearing. -/
structure Utterance where
  /-- The identity-carrying side (which one). First position. -/
  token : Mark
  /-- The content-carrying side (what is said). Second position. -/
  claim : Mark
  deriving DecidableEq, Repr, Inhabited

namespace Utterance

/-- Read off the mark sitting at a given kind/position of the utterance. This is
how "the two kinds of mark" are recovered: by position, not by separate type. -/
def at_ : Utterance → Kind → Mark
  | u, .token => u.token
  | u, .claim => u.claim

@[simp] theorem at_token (u : Utterance) : u.at_ .token = u.token := rfl
@[simp] theorem at_claim (u : Utterance) : u.at_ .claim = u.claim := rfl

end Utterance

end Obsmetrologia
