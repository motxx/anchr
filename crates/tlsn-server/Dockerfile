FROM rust:1-bookworm@sha256:fdb91abf3cb33f1ebc84a76461d2472fd8cf606df69c181050fa7474bade2895 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml ./
COPY src/ src/
RUN cargo build --release --bin tlsn-server

FROM debian:bookworm-slim@sha256:4724b8cc51e33e398f0e2e15e18d5ec2851ff0c2280647e1310bc1642182655d
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tor && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tlsn-server /usr/local/bin/
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN adduser --disabled-password --gecos "" tlsn
USER tlsn

EXPOSE 7046 7047
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["tlsn-server", "--tcp-port", "7046", "--ws-port", "7047"]
