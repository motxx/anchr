# Remove future/migration meta-commentary from architecture.md

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0202

Blocks:
- None

## Summary

`docs/architecture.md` asserts the current map is the target map, then speaks in
future tense about work that has not landed and cites now-closed issues. The
repo rule forbids historical/aspirational meta-commentary in live docs, and this
makes it ambiguous whether the doc describes reality or a roadmap.

## Rationale

- `docs/architecture.md` (~line 107 "current repository map is the target map")
  vs ~298-299 ("after the package collapse and repository pruning work lands"),
  ~335-338 ("Follow-On Work"), and closed-issue references (~226-230).
- Overlaps the VerificationFactor section rewritten in 0202.

## Acceptance

- architecture.md describes the current contract in present tense; "after …
  lands" / "Follow-On Work" migration language and closed-issue pointers are
  removed (durable trade-offs move to an ADR only if they meet the ADR bar).

## Verification

- `rg -n "Follow-On Work|after .* lands|Issues? 01" docs/architecture.md`
  returns no meta-commentary matches.

## Plan

- After 0202 settles the VerificationFactor section, sweep the remaining
  future-tense/roadmap language.
