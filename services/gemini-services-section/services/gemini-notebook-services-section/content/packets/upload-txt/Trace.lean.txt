import Obsmetrologia.Articulation.Articulating
import Obsmetrologia.Closure.Ordinal

/-!
# Trace — carriers folded from a finite ordinal slice

A `Trace Step Carrier` is the finite fold shape used when a sequence of steps
is accumulated into one carrier. The sequence is not a freely built `List`: it
is a **move** function `Fin len → Step`, sliced directly from the finite
ordinal `len` (`Ord.ofNat len`, `Obsmetrologia.Closure.OrdinalCore`) — the same
"how many layers deep" reading `Articulating.depth` already gives, generalized
to an arbitrary payload. This is the processual correspondence *move → step →
trace*, parallel to *it → bit → byte*
(`dev/content/notes/2026/07/01/2026-07-01-it-bit-byte-articulation-witness-carrier.md`):
a **move** is one address in the ordinal slice, read backward like `it`; a
**step** is the forward record carried at that move, like a `bit`; a **trace**
folds every move's step through `advance`, starting at `seed`, into the
accumulated **carrier**, the byte-like object that preserves the whole record.
The Articulating instance takes `Utterance` steps, starts from
`Articulating.utter`, and advances by `Articulating.pair`.

## Main definitions

* `Trace` — a finite ordinal-sliced move function, a seed carrier, and an
  advance operation.
* `Trace.carrier` — the accumulated carrier obtained by `Trace.foldMoves`.
* `Trace.articulating` — the base Articulating trace, folding utterance moves
  by the constructors `utter` and `pair`.
* `Trace.ofArticulating` — the trace read back from an existing `Articulating`.

## Main results

* `Trace.carrier_snoc` — appending one step advances the carrier once.
* `Trace.articulating_carrier_depth` / `Trace.articulating_carrier_floor` —
  the Articulating trace has the expected depth and floor.
* `Trace.ofArticulating_carrier` — reading a trace from an Articulating and
  folding it back returns the original carrier.

## Tags

trace, articulating, ordinal slice, move, step, byte carrier
-/

namespace Obsmetrologia

universe u v

/-- A trace is a finite word of steps sliced from a finite ordinal: `len`
addresses, each a **move** carrying one **step**, together with the fold data
(`seed`, `advance`) that accumulates the moves into a **carrier**. The word is
the slice `Fin len → Step` cut from the ordinal `len`, not a freely built
`List`. -/
structure Trace (Step : Type u) (Carrier : Type v) where
  /-- The carrier before any move has been applied. -/
  seed : Carrier
  /-- How many moves deep the word is sliced — a finite ordinal (`Ord.ofNat len`). -/
  len : Nat
  /-- The step carried at each move, sliced from the ordinal `len`. -/
  move : Fin len → Step
  /-- Advance the carrier by one step. -/
  advance : Carrier → Step → Carrier

namespace Trace

variable {Step : Type u} {Carrier : Type v}

/-- Fold the moves below `k` into a carrier, by structural recursion on `k`. Peels the
*last* address at each step, so the move at `k` is applied last (left-to-right order). -/
def foldMoves (advance : Carrier → Step → Carrier) :
    (k : Nat) → (Fin k → Step) → Carrier → Carrier
  | 0, _, c => c
  | k + 1, f, c => advance (foldMoves advance k (fun i => f i.castSucc) c) (f (Fin.last k))

/-- The accumulated carrier of a trace. -/
def carrier (t : Trace Step Carrier) : Carrier :=
  foldMoves t.advance t.len t.move t.seed

/-- The number of addressable moves in a trace. -/
def length (t : Trace Step Carrier) : Nat :=
  t.len

/-- Read the step at an address in the trace. -/
def address (t : Trace Step Carrier) (i : Fin t.len) : Step :=
  t.move i

/-- The ordinal this trace's word is sliced from — the actual `Ord` value
`Ord.ofNat len`, not a bare count read as one by convention. By
`Ord.isFinite_iff_exists_ofNat` every finite ordinal arises this way, so this
is not a restriction: slicing by `len : Nat` already reaches exactly the
strict-finite fragment of `Ord`. -/
def ord (t : Trace Step Carrier) : Ord := Ord.ofNat t.len

@[simp] theorem ord_isFinite (t : Trace Step Carrier) : t.ord.isFinite = true :=
  Ord.ofNat_isFinite t.len

/-- Every trace sits in the **strict** closure regime — not by assumption, but
because its own address-ordinal is a `Ord.ofNat`, and every `ofNat` ordinal
classifies as `strict` regardless of the other regime data. -/
theorem ord_regime_strict (t : Trace Step Carrier) (scottContinuous countableCofinality : Bool) :
    t.ord.regimeOfOrd scottContinuous countableCofinality = ClosureRegime.strict :=
  Ord.finite_ord_is_strict t.len scottContinuous countableCofinality

/-- Extend a `k`-move word by one final step at address `k`. -/
def extendMove {k : Nat} (f : Fin k → Step) (s : Step) : Fin (k + 1) → Step :=
  fun i => if h : i.val < k then f ⟨i.val, h⟩ else s

/-- Extend a trace by one final move. -/
def snoc (t : Trace Step Carrier) (s : Step) : Trace Step Carrier where
  seed := t.seed
  len := t.len + 1
  move := extendMove t.move s
  advance := t.advance

@[simp] theorem extendMove_castSucc {k : Nat} (f : Fin k → Step) (s : Step) (i : Fin k) :
    extendMove f s i.castSucc = f i := by
  simp [extendMove, i.isLt]

@[simp] theorem extendMove_last {k : Nat} (f : Fin k → Step) (s : Step) :
    extendMove f s (Fin.last k) = s := by
  simp [extendMove]

theorem foldMoves_extendMove (advance : Carrier → Step → Carrier)
    {k : Nat} (f : Fin k → Step) (s : Step) (c : Carrier) :
    foldMoves advance (k + 1) (extendMove f s) c
      = advance (foldMoves advance k f c) s := by
  show advance (foldMoves advance k (fun i => extendMove f s i.castSucc) c)
      (extendMove f s (Fin.last k)) = _
  simp only [extendMove_castSucc, extendMove_last]

@[simp] theorem carrier_mk (seed : Carrier) (len : Nat) (move : Fin len → Step)
    (advance : Carrier → Step → Carrier) :
    (Trace.mk seed len move advance).carrier = foldMoves advance len move seed :=
  rfl

@[simp] theorem length_mk (seed : Carrier) (len : Nat) (move : Fin len → Step)
    (advance : Carrier → Step → Carrier) :
    (Trace.mk seed len move advance).length = len :=
  rfl

@[simp] theorem carrier_snoc (t : Trace Step Carrier) (s : Step) :
    (t.snoc s).carrier = t.advance t.carrier s := by
  show foldMoves t.advance (t.len + 1) (extendMove t.move s) t.seed = _
  rw [foldMoves_extendMove]
  rfl

@[simp] theorem length_snoc (t : Trace Step Carrier) (s : Step) :
    (t.snoc s).length = t.length + 1 := rfl

/-! ## Articulating trace -/

/-- One Articulating trace step: place an utterance over the accumulated carrier. -/
def articulatingAdvance (a : Articulating) (u : Utterance) : Articulating :=
  Articulating.pair u a

/-- The Articulating trace: start at `utter floor` and fold `n` utterance moves,
sliced from the ordinal `n`, by `pair`. -/
def articulating (floor : Utterance) (n : Nat) (moves : Fin n → Utterance) :
    Trace Utterance Articulating where
  seed := Articulating.utter floor
  len := n
  move := moves
  advance := articulatingAdvance

@[simp] theorem articulating_empty_carrier (floor : Utterance) :
    (articulating floor 0 Fin.elim0).carrier = Articulating.utter floor :=
  rfl

theorem articulating_snoc_carrier (floor u : Utterance) (n : Nat) (moves : Fin n → Utterance) :
    (articulating floor (n + 1) (extendMove moves u)).carrier =
      Articulating.pair u (articulating floor n moves).carrier := by
  show ((articulating floor n moves).snoc u).carrier = _
  rw [carrier_snoc]
  rfl

/-- Folding utterance moves by `pair` increases Articulating depth by the
number of moves. -/
theorem foldMoves_articulatingAdvance_depth {n : Nat} (moves : Fin n → Utterance) :
    ∀ a : Articulating,
      (foldMoves articulatingAdvance n moves a).depth = a.depth + n := by
  induction n with
  | zero => intro a; rfl
  | succ n ih =>
      intro a
      show (articulatingAdvance
              (foldMoves articulatingAdvance n (fun i => moves i.castSucc) a)
              (moves (Fin.last n))).depth = a.depth + (n + 1)
      show (foldMoves articulatingAdvance n (fun i => moves i.castSucc) a).depth + 1
          = a.depth + (n + 1)
      rw [ih (fun i => moves i.castSucc)]
      omega

/-- Folding utterance moves by `pair` preserves the primitive floor. -/
theorem foldMoves_articulatingAdvance_floor {n : Nat} (moves : Fin n → Utterance) :
    ∀ a : Articulating,
      (foldMoves articulatingAdvance n moves a).floor = a.floor := by
  induction n with
  | zero => intro a; rfl
  | succ n ih =>
      intro a
      show (articulatingAdvance
              (foldMoves articulatingAdvance n (fun i => moves i.castSucc) a)
              (moves (Fin.last n))).floor = a.floor
      show (foldMoves articulatingAdvance n (fun i => moves i.castSucc) a).floor = a.floor
      exact ih (fun i => moves i.castSucc) a

/-- The depth of an Articulating trace carrier is exactly the number of folded
utterance moves. -/
theorem articulating_carrier_depth (floor : Utterance) (n : Nat) (moves : Fin n → Utterance) :
    (articulating floor n moves).carrier.depth = n := by
  have h := foldMoves_articulatingAdvance_depth moves (Articulating.utter floor)
  simpa [articulating, carrier, Articulating.depth] using h

/-- **The ordinal an articulating reaches**, built by the same recursion `depth` runs:
a `utter` leaf sits at `Ord.zero`, each `pair` layer takes one `Ord.succ` step — the
successor-tower `Ord` already carries, read directly off `Articulating`'s own shape
rather than through a `Nat` count. -/
def articulatingToOrd : Articulating → Ord
  | Articulating.utter _ => Ord.zero
  | Articulating.pair _ a => Ord.succ (articulatingToOrd a)

/-- **`depth` is `our ℕ`, not free-standing `Nat`.** The ordinal `articulatingToOrd`
builds directly from an articulating's shape is exactly `Ord.ofNat` of its `depth` — so
the `Nat` `depth` returns (`Articulating.lean`) is not a count borrowed ahead of where
number is derived; it is the finite ordinal `articulatingToOrd` reaches, presented as a
`Nat` for computational convenience, with `articulatingToOrd` as the witness that no
free data was smuggled in. -/
theorem articulatingToOrd_eq_ofNat_depth :
    ∀ a : Articulating, articulatingToOrd a = Ord.ofNat a.depth
  | Articulating.utter _ => rfl
  | Articulating.pair _ a => by
      show Ord.succ (articulatingToOrd a) = Ord.ofNat (a.depth + 1)
      rw [articulatingToOrd_eq_ofNat_depth a, Ord.ofNat]

/-- The floor of an Articulating trace carrier is the trace floor. -/
theorem articulating_carrier_floor (floor : Utterance) (n : Nat) (moves : Fin n → Utterance) :
    (articulating floor n moves).carrier.floor = floor := by
  simpa [articulating, carrier] using
    foldMoves_articulatingAdvance_floor moves (Articulating.utter floor)

/-- Read an existing Articulating as a trace whose fold reconstructs it. -/
def ofArticulating : Articulating → Trace Utterance Articulating
  | Articulating.utter u => articulating u 0 Fin.elim0
  | Articulating.pair u a => (ofArticulating a).snoc u

/-- The trace read from an Articulating always advances by `pair`. -/
theorem ofArticulating_advance (a : Articulating) :
    (ofArticulating a).advance = articulatingAdvance := by
  induction a with
  | utter u => rfl
  | pair u a ih =>
      simp [ofArticulating, snoc, ih]

/-- Folding the trace read from an Articulating returns the original carrier. -/
theorem ofArticulating_carrier (a : Articulating) :
    (ofArticulating a).carrier = a := by
  induction a with
  | utter u => rfl
  | pair u a ih =>
      change ((ofArticulating a).snoc u).carrier = Articulating.pair u a
      rw [carrier_snoc, ofArticulating_advance a, ih]
      rfl

/-- The trace read from an Articulating has the same length as its depth. -/
theorem ofArticulating_length (a : Articulating) :
    (ofArticulating a).length = a.depth := by
  induction a with
  | utter u => rfl
  | pair u a ih =>
      change ((ofArticulating a).snoc u).length = (Articulating.pair u a).depth
      rw [length_snoc, ih]
      rfl

end Trace

end Obsmetrologia
