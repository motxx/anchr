# Stop untrusted-input panics from byte-offset string slicing in tlsn

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Several tlsn code paths slice `str` values at byte offsets derived from
untrusted input without checking UTF-8 char boundaries, so a crafted
reveal range or chunk length that lands mid-multibyte-character panics the
handling task — a denial of service on network-facing paths.

## Rationale

- `crates/tlsn-server/src/main.rs`: `result.sent_transcript[start..end]` and
  `recv_transcript[start..end]` (~lines 220, 241) take `start`/`end` from
  prover-supplied `reveal_config`; the guard checks bounds but not char
  boundaries. Preview slice at ~line 311 has the same flaw.
- `crates/tlsn-verifier/src/main.rs`: chunked-body decode slices
  `&remaining[data_start..data_start + chunk_size]` (~line 154) where
  `chunk_size` is parsed from untrusted hex.

## Acceptance

- All slicing on transcript/body data derived from untrusted input operates on
  byte slices (`get(..)`, `is_char_boundary`, or byte search), returning a
  handled error instead of panicking.

## Verification

- Rust test: a reveal range and a chunk length landing mid-multibyte-char both
  return an error rather than panicking (added under 0183 harness).

## Plan

- Replace `str[start..end]` slicing with `get(start..end)` + `None` handling or
  byte-slice operations.
- Add non-ASCII / boundary-crossing test fixtures.
