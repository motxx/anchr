FROM rust:1-bookworm@sha256:adab7941580c74513aa3347f2d2a1f975498280743d29ec62978ba12e3540d3a AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml ./
COPY src/ src/
RUN cargo build --release --bin tlsn-server

FROM debian:bookworm-slim@sha256:67b30a61dc87758f0caf819646104f29ecbda97d920aaf5edc834128ac8493d3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tor && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tlsn-server /usr/local/bin/
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN adduser --disabled-password --gecos "" tlsn
USER tlsn

EXPOSE 7046 7047
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["tlsn-server", "--tcp-port", "7046", "--ws-port", "7047"]
