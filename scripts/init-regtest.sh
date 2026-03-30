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

# 1. Wait for LND nodes to be reachable
echo "[1/5] Waiting for LND nodes to be reachable..."
for i in $(seq 1 40); do
  MINT_UP=$(docker compose exec -T lnd-mint lncli --network regtest --rpcserver lnd-mint:10009 getinfo 2>/dev/null && echo "yes" || true)
  USER_UP=$(docker compose exec -T lnd-user lncli --network regtest --rpcserver lnd-user:10009 getinfo 2>/dev/null && echo "yes" || true)
  if [ -n "$MINT_UP" ] && [ -n "$USER_UP" ]; then
    echo "      Both LND nodes reachable."
    break
  fi
  echo "      Waiting... ($i/40)"
  sleep 3
done

# 2. Create wallet & mine blocks (in batches for LND sync)
echo "[2/5] Creating Bitcoin wallet and mining 150 blocks..."
$BITCOIN_CLI createwallet cashu 2>/dev/null || $BITCOIN_CLI loadwallet cashu 2>/dev/null || true
# Mine in batches to let LND process block notifications
$BITCOIN_CLI -generate 50 > /dev/null
sleep 2
$BITCOIN_CLI -generate 50 > /dev/null
sleep 2
$BITCOIN_CLI -generate 50 > /dev/null
echo "      Done. Waiting for LND to sync..."

# Wait for LND to sync the mined blocks
CHAIN_HEIGHT=$($BITCOIN_CLI getblockcount)
echo "      Chain height: $CHAIN_HEIGHT. Waiting for LND to reach it..."
SYNCED=""
for i in $(seq 1 90); do
  MINT_HEIGHT=$($LNCLI_MINT getinfo 2>/dev/null | grep '"block_height"' | head -1 | sed 's/[^0-9]//g')
  USER_HEIGHT=$($LNCLI_USER getinfo 2>/dev/null | grep '"block_height"' | head -1 | sed 's/[^0-9]//g')
  MINT_HEIGHT=${MINT_HEIGHT:-0}
  USER_HEIGHT=${USER_HEIGHT:-0}
  if [ "$MINT_HEIGHT" -ge "$CHAIN_HEIGHT" ] && [ "$USER_HEIGHT" -ge "$CHAIN_HEIGHT" ]; then
    echo "      Both nodes at height $CHAIN_HEIGHT."
    SYNCED="yes"
    break
  fi
  echo "      Waiting... ($i/90) mint=$MINT_HEIGHT user=$USER_HEIGHT target=$CHAIN_HEIGHT"
  sleep 3
done

if [ -z "$SYNCED" ]; then
  echo "ERROR: LND nodes failed to reach chain height $CHAIN_HEIGHT after 270s" >&2
  echo "  lnd-mint height: $MINT_HEIGHT" >&2
  echo "  lnd-user height: $USER_HEIGHT" >&2
  docker compose logs --tail=10 lnd-mint 2>&1 | head -10 >&2
  docker compose logs --tail=10 lnd-user 2>&1 | head -10 >&2
  exit 1
fi

# 3. Fund LND nodes
echo "[3/5] Funding LND nodes..."
set +e
MINT_ADDR_JSON=$($LNCLI_MINT newaddress p2wkh 2>&1)
MINT_RC=$?
set -e
if [ $MINT_RC -ne 0 ]; then
  echo "ERROR: lnd-mint newaddress failed (rc=$MINT_RC): $MINT_ADDR_JSON" >&2
  exit 1
fi
MINT_ADDR=$(echo "$MINT_ADDR_JSON" | grep -o '"address": "[^"]*"' | cut -d'"' -f4)

set +e
USER_ADDR_JSON=$($LNCLI_USER newaddress p2wkh 2>&1)
USER_RC=$?
set -e
if [ $USER_RC -ne 0 ]; then
  echo "ERROR: lnd-user newaddress failed (rc=$USER_RC): $USER_ADDR_JSON" >&2
  exit 1
fi
USER_ADDR=$(echo "$USER_ADDR_JSON" | grep -o '"address": "[^"]*"' | cut -d'"' -f4)

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
