FROM oven/bun:1.3.8 AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates curl \
  && curl -sSL https://github.com/contentauth/c2patool/releases/download/v0.26.33/c2patool-v0.26.33-x86_64-unknown-linux-gnu.tar.gz \
     | tar -xz -C /usr/local/bin c2patool \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV REFERENCE_APP_PORT=8080
ENV RUNTIME_DATA_DIR=/data

EXPOSE 8080

CMD ["bun", "run", "src/http-server.ts"]
