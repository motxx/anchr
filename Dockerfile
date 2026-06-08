# Build tlsn-verifier binary
FROM rust:1-bookworm@sha256:503651ea31e66ecb74623beabde781059a5978df1595a9e8ed03974d5fec1bf0 AS rust-builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY crates/tlsn-verifier/Cargo.toml ./crates/tlsn-verifier/
COPY crates/tlsn-verifier/src/ ./crates/tlsn-verifier/src/
RUN cd crates/tlsn-verifier && cargo build --release

# Build tlsn-prover binary (for auto-worker)
COPY crates/tlsn-prover/Cargo.toml ./crates/tlsn-prover/
COPY crates/tlsn-prover/src/ ./crates/tlsn-prover/src/
RUN cd crates/tlsn-prover && cargo build --release

# Main app
FROM denoland/deno@sha256:797108ae228b32cacd9050a4a168c330c98c1b439a8d9950461834874b5523ba AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates curl tor npm \
  && curl -sSL https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.26.37/c2patool-v0.26.37-x86_64-unknown-linux-gnu.tar.gz \
     | tar -xz --strip-components=1 -C /usr/local/bin c2patool \
  && rm -rf /var/lib/apt/lists/*

# Copy Rust binaries
COPY --from=rust-builder /build/crates/tlsn-verifier/target/release/tlsn-verifier /usr/local/bin/
COPY --from=rust-builder /build/crates/tlsn-prover/target/release/tlsn-prove /usr/local/bin/

# Copy the root manifest plus every workspace member's deno.json so that
# `deno install` can resolve workspace packages before the rest of the
# source tree lands in the next COPY step.
COPY deno.json deno.lock ./
COPY packages/protocol/deno.json ./packages/protocol/
COPY packages/sdk/deno.json ./packages/sdk/
COPY examples/paid-request-simulation/deno.json ./examples/paid-request-simulation/
RUN deno install

COPY . .

ENV NODE_ENV=production
ENV HTTP_API_PORT=8080
ENV RUNTIME_DATA_DIR=/data

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN adduser --disabled-password --gecos "" anchr
USER anchr

EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["deno", "task", "start"]
