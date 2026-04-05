# Build tlsn-verifier binary
FROM rust:1-bookworm AS rust-builder
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
FROM denoland/deno@sha256:869e31370dca82b10abefeabe92a2efae44c0d8c70e03776b05ca07ce6b2e062 AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates curl tor npm \
  && curl -sSL https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.26.37/c2patool-v0.26.37-x86_64-unknown-linux-gnu.tar.gz \
     | tar -xz --strip-components=1 -C /usr/local/bin c2patool \
  && rm -rf /var/lib/apt/lists/*

# Copy Rust binaries
COPY --from=rust-builder /build/crates/tlsn-verifier/target/release/tlsn-verifier /usr/local/bin/
COPY --from=rust-builder /build/crates/tlsn-prover/target/release/tlsn-prove /usr/local/bin/

COPY deno.json deno.lock ./
RUN deno install

COPY . .

# Build frontend
RUN deno task build:ui
# Tailwind CSS v4: @import "tailwindcss" needs the package resolvable.
# Install in /tmp to avoid conflicts with Deno's node_modules, then
# run the CLI directly.
RUN cd /tmp && npm init -y -q && npm install -q tailwindcss @tailwindcss/cli 2>/dev/null \
  && /tmp/node_modules/.bin/tailwindcss -i /app/src/ui/globals.css -o /app/dist/ui/generated.css \
  && /tmp/node_modules/.bin/tailwindcss -i /app/src/ui/requester/globals.css -o /app/dist/ui/requester/generated.css \
  && /tmp/node_modules/.bin/tailwindcss -i /app/src/ui/dashboard/globals.css -o /app/dist/ui/dashboard/generated.css \
  && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

ENV NODE_ENV=production
ENV REFERENCE_APP_PORT=8080
ENV RUNTIME_DATA_DIR=/data

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN adduser --disabled-password --gecos "" anchr
USER anchr

EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["deno", "task", "start"]
