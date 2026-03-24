FROM rust:1-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml ./
COPY src/ src/
RUN cargo build --release --bin tlsn-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tlsn-server /usr/local/bin/
EXPOSE 7046 7047
CMD ["tlsn-server", "--tcp-port", "7046", "--ws-port", "7047"]
