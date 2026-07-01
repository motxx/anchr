# Document or relocate the top-level mobile/ product shell

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

A whole top-level `mobile/` app shell (Expo/React Native iOS) exists but is
absent from the architecture map, which claims to be the complete target
repository map and states that "top-level product shells are not a maintained
top-level category." Either the map is stale or the repo violates its own
stated policy.

## Rationale

- `mobile/` (`mobile/ios/Podfile`, `mobile/.expo/`) is not in
  `docs/architecture.md` Component Boundaries (~lines 126-140) or `README.md`
  Repository Map (~lines 161-168); architecture.md ~296-297 says product shells
  are not maintained top-level.

## Acceptance

- `mobile/` is either documented in the Component Boundaries table with an
  owner/status, or removed/relocated consistent with the stated policy.

## Verification

- The architecture map and the actual top-level directories agree (no
  undocumented major top-level dir).

## Plan

- Decide keep-and-document vs relocate/remove; apply.
