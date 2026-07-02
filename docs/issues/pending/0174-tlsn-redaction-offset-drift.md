# Fix TLSN redaction offsets computed on a lossy UTF-8 copy

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

The selective-disclosure feature computes redaction byte ranges over a
lossy UTF-8 copy of the sent transcript but applies them to the original
bytes. Any invalid UTF-8 in the transcript shifts every subsequent offset, so
the header this feature exists to hide (e.g. `Authorization`, `Cookie`) can be
revealed or the wrong bytes redacted — a silent secret-disclosure bug inside
the security feature itself.

## Rationale

- `crates/tlsn-prover/src/main.rs`: `find_header_value_ranges` computes ranges
  over `String::from_utf8_lossy(sent_bytes)` (~lines 865-897) but
  `build_presentation` applies them to the raw `sent_bytes` (~lines 941-950).
- `from_utf8_lossy` inserts 3-byte replacement chars, desynchronising offsets.

## Acceptance

- Header positions are located on the raw `&[u8]` transcript (byte search for
  `\r\n` and `:`), so redaction ranges are byte-accurate regardless of
  transcript encoding.

## Verification

- Rust test: a transcript with a non-ASCII header value redacts exactly the
  secret bytes (added under 0183 harness).

## Plan

- Reimplement `find_header_value_ranges` on bytes.
- Add tests with non-ASCII and invalid-UTF-8 header values.
