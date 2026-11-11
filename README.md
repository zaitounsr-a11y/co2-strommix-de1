# PICKED — hint engine (proof of logic, no framework)

Two files, zero dependencies, runs with plain `node`:

- `hintEngine.js` — the actual logic: Round 4 broad hint (with the anonymity-safety check) and the Curiosity precise hint.
- `demo.js` — a deterministic 10-women x 10-men dataset with two scenarios deliberately built in, run with `node demo.js`.

## What the demo proves

**Scenario 1 — the safety check actually blocks a leak.** The data is rigged so that W1's most interesting possible Round 4 hint ("someone outside your Top 5 is thinking about you") would, if shown, be true of exactly one man. The engine's own diagnostic print confirms this (`candidates satisfying the raw predicate: 1`), and then shows the engine refusing to use that template — it silently falls through the whole template list (even `blind_spot`, which also collapses to that same one person) and lands on the generic, name-nobody fallback line instead. This is the one piece of the whole app that must never be wrong, so it's the one piece I built and tested first, before any UI or database.

**Scenario 2 — "close to a date" and the Curiosity escalation.** W2 and M3 are engineered to become a mutual #1↔#1 pair by Round 3 (M3's opinion of W2 also swings hard, #9 → #1). Both of them independently get the "You might be close to leaving tonight with a date" hint. When W2 later picks M3 in Curiosity, she gets: *"You rank this person #1. They have moved you from #9 to #1 since Round 1"* — matching the "reciprocity + change" style from your spec. When M3 picks W2 back, he gets the plain reciprocity line instead, because **the movement shown is always the other person's movement, never the player's own** — a player already knows how their own feelings evolved over the night; what's actually new information to them is learning how the *other* person's view of them changed. That asymmetry is intentional, not a bug — worth knowing since it'll look odd in a code review if you don't know why it's there.

## Why some outputs repeat across players

In the demo's `node demo.js` output, W3 through W10 all get the identical `reciprocity_outside_top5` hint. That's an artifact of the toy dataset (a clean rotating/cyclic pattern, built that way on purpose so the numbers are easy to reason about) — every one of those women happens to land on the same safe-template outcome by construction. It is not something the real engine does by default; a real night's rankings, made by 20 actual people, won't be this symmetric, and the template mix across the room will vary. Don't read the repetition as a flaw — read the W1/W2/M3 cases as the actual proof points.

## What's deliberately NOT in here yet

- **Interaction-based clues** ("one of your pair interactions created a stronger impression than you realize") are not implemented. A player's Round 3A/3B partner set is closed at ≤2 people, so it can almost never clear the anonymity bar on its own — re-add it only with its own dedicated, stricter check.
- **Persistence.** This takes an in-memory `rankings` object; wiring it to whatever you end up storing rankings in (SQLite, Postgres, a flat JSON file for the first test) is a thin adapter, not a redesign.
- **The "which template's candidate set to log" audit trail.** `generateRound4Hint` returns `candidates` for exactly this reason — keep it server-side, log it per player per event, and you have a debuggable record of *why* each hint was chosen without ever exposing it to a client.

## Extending it

- `MIN_ANONYMITY_SET` (currently `2`) is the one constant most worth playtesting with a real group before deciding on production. It's how many people a Round 4 hint's "someone" has to plausibly be.
- All thresholds (`topHalf`, `topFraction`, `bottomFractionStart`) are relative to pool size, not hardcoded to 10 — so an uneven gender ratio or a no-show (a 9-person or 8-person pool) still produces sensible, correctly-scaled hints instead of silently breaking.
- The "close to a date" threshold is currently exact mutual #1↔#1. Loosening it (e.g. mutual top-2) is a one-line change in `checkCloseToDate`, traded against more false-hope risk.
