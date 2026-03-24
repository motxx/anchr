FROM rust:1.83-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
RUN cargo build --release --bin tlsn-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tlsn-server /usr/local/bin/
EXPOSE 7047
CMD ["tlsn-server", "--port", "7047"]
