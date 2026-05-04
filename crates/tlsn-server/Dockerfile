FROM rust:1-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml ./
COPY src/ src/
RUN cargo build --release --bin tlsn-server

FROM debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tor && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tlsn-server /usr/local/bin/
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN adduser --disabled-password --gecos "" tlsn
USER tlsn

EXPOSE 7046 7047
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["tlsn-server", "--tcp-port", "7046", "--ws-port", "7047"]
