FROM oven/bun:1.3.8 AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV REFERENCE_APP_PORT=8080
ENV RUNTIME_DATA_DIR=/data

EXPOSE 8080

CMD ["bun", "run", "src/http-server.ts"]
