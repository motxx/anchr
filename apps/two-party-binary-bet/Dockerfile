# Build stage 1: Rust binaries (tlsn-verifier + frost-signer).
# Both binaries live in the running container so the market server can
# verify TLSNotary presentations locally and drive the in-process FROST
# cluster.
FROM rust:1-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55 AS rust-builder
RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY crates/tlsn-verifier/Cargo.toml ./crates/tlsn-verifier/
COPY crates/tlsn-verifier/src/ ./crates/tlsn-verifier/src/
RUN cd crates/tlsn-verifier && cargo build --release
COPY crates/frost-signer/Cargo.toml ./crates/frost-signer/
COPY crates/frost-signer/src/ ./crates/frost-signer/src/
RUN cd crates/frost-signer && cargo build --release

# Build stage 2: Deno + UI bundle + Tailwind CSS.
FROM denoland/deno@sha256:9c47e8b8fa41e91fe2dd1448888244a56c4ec90124333d5341319b043a3a6ca0 AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends adduser ca-certificates curl npm tini \
  && rm -rf /var/lib/apt/lists/*

# Native binaries built above
COPY --from=rust-builder /build/crates/tlsn-verifier/target/release/tlsn-verifier /usr/local/bin/
COPY --from=rust-builder /build/crates/frost-signer/target/release/frost-signer /usr/local/bin/

# Workspace deno.json files first so `deno install` can resolve before
# the rest of the source tree lands.
COPY deno.json deno.lock ./
COPY packages/core-runtime/deno.json ./packages/core-runtime/
COPY packages/core-cashu/deno.json ./packages/core-cashu/
COPY packages/tlsn-toolkit/deno.json ./packages/tlsn-toolkit/
COPY packages/photo-verification/deno.json ./packages/photo-verification/
COPY packages/frost-oracle/deno.json ./packages/frost-oracle/
COPY packages/cashu-conditional-swap/deno.json ./packages/cashu-conditional-swap/
COPY packages/blossom/deno.json ./packages/blossom/
COPY packages/protocol/deno.json ./packages/protocol/
COPY packages/oracle-sdk/deno.json ./packages/oracle-sdk/
COPY packages/customer-sdk/deno.json ./packages/customer-sdk/
COPY packages/provider-sdk/deno.json ./packages/provider-sdk/
COPY packages/bounty/deno.json ./packages/bounty/
COPY packages/sdk/deno.json ./packages/sdk/
COPY apps/airdrop-bot-shield/deno.json ./apps/airdrop-bot-shield/
COPY examples/tlsn-fiat-swap-square/deno.json ./examples/tlsn-fiat-swap-square/
RUN deno install

COPY . .

# Build the bundled UI + Tailwind output. The market UI is bundled
# in-place under apps/two-party-binary-bet/ui/.
RUN deno task build:ui
RUN deno task build:css

ENV NODE_ENV=production
ENV MARKET_PORT=8080
ENV PATH="/usr/local/bin:${PATH}"

# Pre-fetch the @db/sqlite native library into the deno cache so the
# runtime user (anchr) doesn't need outbound network or write access to
# /deno-dir at boot. Without this, the first import of "@db/sqlite"
# tries to mkdir /deno-dir/plug as anchr and fails.
RUN deno eval --config deno.json \
    'import { Database } from "@db/sqlite"; const d = new Database(":memory:"); d.close();'

# The orchestrator decrypts the FROST signer configs from env, spawns
# the three signer nodes in this VM, then starts the market server.
RUN adduser --disabled-password --gecos "" anchr
RUN mkdir -p /data && chown -R anchr:anchr /data
RUN chown -R anchr:anchr /deno-dir
USER anchr

EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["deno", "run", "--allow-all", "--config", "deno.json", "apps/two-party-binary-bet/scripts/cluster-entrypoint.ts"]
