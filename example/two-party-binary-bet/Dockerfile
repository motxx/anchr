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
COPY packages/photo-bounty/deno.json ./packages/photo-bounty/
COPY packages/cashu-frost-oracle/deno.json ./packages/cashu-frost-oracle/
COPY packages/cashu-conditional-swap/deno.json ./packages/cashu-conditional-swap/
COPY packages/sdk/deno.json ./packages/sdk/
RUN deno install

COPY . .

# Build the bundled UI + Tailwind output. The market UI is bundled
# in-place under example/two-party-binary-bet/ui/.
RUN deno task build:ui
RUN cd /tmp && npm init -y -q && npm install -q tailwindcss @tailwindcss/cli 2>/dev/null \
  && ln -sf /tmp/node_modules /app/example/two-party-binary-bet/ui/node_modules \
  && /tmp/node_modules/.bin/tailwindcss \
       -i /app/example/two-party-binary-bet/ui/globals.css \
       -o /app/example/two-party-binary-bet/ui/generated.css \
  && rm -f /app/example/two-party-binary-bet/ui/node_modules \
  && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

ENV NODE_ENV=production
ENV MARKET_PORT=8080
ENV PATH="/usr/local/bin:${PATH}"

# The orchestrator decrypts the FROST signer configs from env, spawns
# the three signer nodes in this VM, then starts the market server.
RUN adduser --disabled-password --gecos "" anchr
RUN mkdir -p /data && chown -R anchr:anchr /data
USER anchr

EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["deno", "run", "--allow-all", "--config", "deno.json", "scripts/market-cluster-entrypoint.ts"]
