# Build tlsn-verifier binary
FROM rust:1-bookworm@sha256:adab7941580c74513aa3347f2d2a1f975498280743d29ec62978ba12e3540d3a AS rust-builder
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
FROM denoland/deno@sha256:564e989f4a93371e70fd8720e5dbe3e027fd4a0daad71a2b008008596ffa6492 AS app

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
COPY packages/core-runtime/deno.json ./packages/core-runtime/
COPY packages/core-cashu/deno.json ./packages/core-cashu/
COPY packages/tlsn-toolkit/deno.json ./packages/tlsn-toolkit/
COPY packages/photo-verification/deno.json ./packages/photo-verification/
COPY packages/frost-oracle/deno.json ./packages/frost-oracle/
COPY packages/cashu-conditional-swap/deno.json ./packages/cashu-conditional-swap/
COPY packages/blossom/deno.json ./packages/blossom/
COPY packages/runtime/deno.json ./packages/runtime/
COPY packages/sdk/deno.json ./packages/sdk/
RUN deno install

COPY . .

# Build frontend
RUN deno task build:ui
# Tailwind CSS v4: @import "tailwindcss" resolves from the input file's
# directory. Symlink node_modules into /app so the CSS resolver finds it.
RUN cd /tmp && npm init -y -q && npm install -q tailwindcss @tailwindcss/cli 2>/dev/null; \
  ln -sf /tmp/node_modules /app/example/two-party-binary-bet/ui/node_modules \
  && /tmp/node_modules/.bin/tailwindcss -i /app/example/two-party-binary-bet/ui/globals.css -o /app/example/two-party-binary-bet/ui/generated.css \
  && rm -f /app/example/two-party-binary-bet/ui/node_modules \
  && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

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
