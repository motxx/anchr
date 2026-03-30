#!/bin/bash
set -e
if [ -n "$SOCKS_PROXY" ]; then
  echo "[entrypoint] Starting Tor..."
  tor --RunAsDaemon 1 --SocksPort 9050 --Log "notice stderr"
  for i in $(seq 1 30); do
    if bash -c "echo >/dev/tcp/127.0.0.1/9050" 2>/dev/null; then
      echo "[entrypoint] Tor ready"; break
    fi
    [ $i -eq 30 ] && echo "[entrypoint] WARNING: Tor not ready after 30s"
    sleep 1
  done
fi
exec "$@"
