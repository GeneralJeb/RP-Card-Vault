#!/bin/sh
# Stops the vault server on this copy's port (8790, or the port set in
# vault.local next to this file), on a Mac or on Linux:
#
#     ./stop.sh
#
# start.sh doesn't need it: a new server asks a running one to stand down.
# Use this to turn the vault off when its window is out of reach.
#
# SAFETY: nothing is stopped by name or by port. The server on the port is
# asked, through the vault's own address, to stop; only a vault server knows
# how to answer, so no other program can be stopped by this.

cd "$(dirname "$0")" || exit 1
DIR=$(pwd)

# Read the same way as start.sh reads it, so both agree on the port.
# --- vault.local ---
VAULT_PORT=8790
if [ -f "$DIR/vault.local" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\r')
    case "$line" in *=*) ;; *) continue ;; esac
    key=$(printf '%s' "${line%%=*}" | tr 'A-Z' 'a-z' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    val=$(printf '%s' "${line#*=}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    case "$key" in
      port) [ -n "$val" ] && VAULT_PORT=${val%%[[:space:]]*} ;;
    esac
  done < "$DIR/vault.local"
fi
case "$VAULT_PORT" in ''|*[!0-9]*) VAULT_PORT=8790 ;; esac
# --- end vault.local ---

URL="http://127.0.0.1:$VAULT_PORT/__vault/shutdown"
echo
echo "  Looking for a vault server on port $VAULT_PORT..."

# The answer's HTTP status: 200 from a vault server that is
# stopping, 000 when nothing answered at all.
CODE=
if command -v curl >/dev/null 2>&1; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST -H 'X-Vault: 1' -H 'Content-Length: 0' "$URL" 2>/dev/null)
else
  NODE=
  if [ -x "$DIR/node/bin/node" ]; then NODE=$DIR/node/bin/node
  elif [ -f "$DIR/node" ] && [ -x "$DIR/node" ]; then NODE=$DIR/node
  elif command -v node >/dev/null 2>&1; then NODE=node
  fi
  if [ -n "$NODE" ]; then
    CODE=$("$NODE" -e 'var r = require("http").request(process.argv[1], { method: "POST", headers: { "X-Vault": "1", "Content-Length": 0 }, timeout: 5000 }, function (x) { x.resume(); console.log(x.statusCode); }); r.on("error", function () { console.log("000"); }); r.on("timeout", function () { r.destroy(); }); r.end();' "$URL" 2>/dev/null)
  fi
fi

echo
case "$CODE" in
  200) echo "  Stopped. Start it again with ./start.sh" ;;
  000|'') echo "  Nothing was listening on $VAULT_PORT." ;;
  *)
    echo "  Something on port $VAULT_PORT answered, but not as a vault server that can"
    echo "  be asked to stop (HTTP $CODE). If it is an old vault server, close its"
    echo "  terminal window or end its node process."
    ;;
esac
echo
