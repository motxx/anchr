#!/usr/bin/env bash
# Initialize the regtest Lightning network for Cashu mint testing.
#
# Usage:
#   docker compose up -d bitcoind lnd-mint lnd-user
#   sleep 25  # wait for LND to start
#   ./scripts/init-regtest.sh
#
# This script:
#   1. Creates a Bitcoin wallet and mines 150 blocks
#   2. Funds both LND nodes
#   3. Opens a channel between them (10M sats capacity)

set -euo pipefail

BITCOIN_CLI="docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=cashu -rpcpassword=cashu"
LNCLI_MINT="docker compose exec -T lnd-mint lncli --network regtest --rpcserver lnd-mint:10009"
LNCLI_USER="docker compose exec -T lnd-user lncli --network regtest --rpcserver lnd-user:10009"

echo "=== Regtest Lightning Init ==="

# 1. Create wallet & mine blocks
echo "[1/5] Creating Bitcoin wallet and mining 150 blocks..."
$BITCOIN_CLI createwallet cashu 2>/dev/null || $BITCOIN_CLI loadwallet cashu 2>/dev/null || true
$BITCOIN_CLI -generate 150 > /dev/null
echo "      Done."

# 2. Wait for LND nodes to sync
echo "[2/5] Waiting for LND nodes to sync..."
for i in $(seq 1 60); do
  MINT_SYNCED=$($LNCLI_MINT getinfo 2>/dev/null | grep -o '"synced_to_chain": true' || true)
  USER_SYNCED=$($LNCLI_USER getinfo 2>/dev/null | grep -o '"synced_to_chain": true' || true)
  if [ -n "$MINT_SYNCED" ] && [ -n "$USER_SYNCED" ]; then
    echo "      Both nodes synced."
    break
  fi
  echo "      Waiting... ($i/60)"
  sleep 3
done

if [ -z "$MINT_SYNCED" ] || [ -z "$USER_SYNCED" ]; then
  echo "ERROR: LND nodes failed to sync after 180s" >&2
  exit 1
fi

# 3. Fund LND nodes
echo "[3/5] Funding LND nodes..."
MINT_ADDR=$($LNCLI_MINT newaddress p2wkh | grep -o '"address": "[^"]*"' | cut -d'"' -f4)
USER_ADDR=$($LNCLI_USER newaddress p2wkh | grep -o '"address": "[^"]*"' | cut -d'"' -f4)

$BITCOIN_CLI sendtoaddress "$MINT_ADDR" 10 > /dev/null
$BITCOIN_CLI sendtoaddress "$USER_ADDR" 10 > /dev/null
$BITCOIN_CLI -generate 6 > /dev/null
echo "      Funded 10 BTC each."

# Wait for funding to be confirmed
sleep 5

# 4. Open channel: lnd-user -> lnd-mint (10M sats, 5M push)
echo "[4/5] Opening channel (10M sats)..."
MINT_PUBKEY=$($LNCLI_MINT getinfo | grep -o '"identity_pubkey": "[^"]*"' | cut -d'"' -f4)
$LNCLI_USER connect "${MINT_PUBKEY}@lnd-mint:9735" 2>/dev/null || true
$LNCLI_USER openchannel "$MINT_PUBKEY" 10000000 5000000 > /dev/null

# Mine blocks to confirm channel
$BITCOIN_CLI -generate 6 > /dev/null
echo "      Channel opened."

# 5. Wait for channel to be active
echo "[5/5] Waiting for channel to be active..."
for i in $(seq 1 20); do
  ACTIVE=$($LNCLI_USER listchannels | grep -o '"active": true' || true)
  if [ -n "$ACTIVE" ]; then
    echo "      Channel active!"
    break
  fi
  sleep 3
done

# Summary
echo ""
echo "=== Ready ==="
MINT_BAL=$($LNCLI_MINT channelbalance | grep -o '"local_balance": {[^}]*"sat": "[^"]*"' | grep -o '"sat": "[^"]*"' | head -1 | cut -d'"' -f4 || true)
USER_BAL=$($LNCLI_USER channelbalance | grep -o '"local_balance": {[^}]*"sat": "[^"]*"' | grep -o '"sat": "[^"]*"' | head -1 | cut -d'"' -f4 || true)
echo "  lnd-mint channel balance: ${MINT_BAL:-0} sats"
echo "  lnd-user channel balance: ${USER_BAL:-0} sats"
echo ""
echo "  Cashu mint: http://localhost:3338"
echo "  LND user REST: https://localhost:8081"
echo ""
echo "  To pay a mint invoice from lnd-user:"
echo "    docker compose exec lnd-user lncli --network regtest payinvoice --force <bolt11>"
