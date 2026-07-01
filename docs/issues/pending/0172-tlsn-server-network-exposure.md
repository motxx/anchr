# Harden tlsn-server network exposure (proxy SSRF, bind, session auth)

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

`tlsn-server` exposes an unauthenticated signing/proxy surface bound on all
interfaces. The `/proxy` WebSocket connects to a client-supplied target
host:port, which is a server-side request forgery / open-relay primitive; the
attestation and MPC endpoints accept work from anyone who can reach the port;
and MPC session state is keyed by a client-chosen, unauthenticated session id.

## Rationale

- `crates/tlsn-server/src/main.rs`: listener binds `0.0.0.0` (~line 97); the
  `/proxy` handler dials a target taken from the request (~lines 134-138,
  `handle_proxy_ws_raw` ~374-474); `handle_tcp_attest` signs for whatever
  session id is presented (~lines 489-556).
- SSRF reach includes internal services and cloud metadata endpoints; an
  exposed unauthenticated signer compounds 0171.

## Acceptance

- The server binds to loopback by default and requires explicit opt-in to bind
  publicly.
- The proxy target is constrained by an allowlist (host/port) and the
  signing/MPC endpoints require authentication.
- The two connections that make up an MPC session are cryptographically bound
  (e.g. a server-issued token) rather than trusting a client-chosen id.

## Verification

- Integration test: an out-of-allowlist proxy target is refused; an
  unauthenticated attestation request is rejected.
- Manual: default startup listens on loopback only.

## Plan

- Default-bind loopback; add a config flag for public bind.
- Add a target allowlist and an auth token/mTLS for signing + MPC endpoints.
- Issue a server-side session token on session open and require it on the
  attest connection.
