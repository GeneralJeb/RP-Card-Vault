#!/bin/sh
# Starts RP Card Vault on a Mac or on Linux. In a terminal, from this folder:
#
#     ./start.sh
#
# On a Mac, double-clicking "Start RP Card Vault.command" runs this for you.
# It does what "Start RP Card Vault.bat" does on Windows: it stops any vault
# server already running on this copy's port and starts a fresh one, so you
# always get the serve.js that is on disk right now. Leave the window open
# while you use the vault; Ctrl+C stops the server.
#
# Anything after the name is passed on to serve.js: ./start.sh --no-open
# starts the server without opening a browser.

cd "$(dirname "$0")" || exit 1
DIR=$(pwd)

# The port the vault runs on. Browser storage is keyed to the address, so
# every port is a separate vault: its own database and folder permissions.
# To run a second copy side by side, give it its own port in a file named
# vault.local next to this one (see HOW TO RUN.txt), e.g.  port=8791
#
# Read the same way as the Windows launchers read it: spaces around a name or
# value are dropped, a name with a space in it is no setting, and a port that
# isn't a number means 8790.
# --- vault.local ---
VAULT_PORT=8790
VAULT_LABEL=
if [ -f "$DIR/vault.local" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\r')
    case "$line" in *=*) ;; *) continue ;; esac
    key=$(printf '%s' "${line%%=*}" | tr 'A-Z' 'a-z' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    val=$(printf '%s' "${line#*=}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    case "$key" in
      port) [ -n "$val" ] && VAULT_PORT=${val%%[[:space:]]*} ;;
      label) VAULT_LABEL=$val ;;
    esac
  done < "$DIR/vault.local"
fi
case "$VAULT_PORT" in ''|*[!0-9]*) VAULT_PORT=8790 ;; esac
# --- end vault.local ---

# The window's title, where there is a window.
if [ -t 1 ]; then
  if [ -n "$VAULT_LABEL" ]; then printf '\033]0;RP Card Vault (%s, port %s)\007' "$VAULT_LABEL" "$VAULT_PORT"
  else printf '\033]0;RP Card Vault (port %s)\007' "$VAULT_PORT"; fi
fi

if [ ! -f "$DIR/RP_Card_Vault.html" ]; then
  echo
  echo "  RP_Card_Vault.html is not in this folder:"
  echo "    $DIR"
  echo
  echo "  Put start.sh next to RP_Card_Vault.html and run it again."
  echo
  exit 1
fi

# A portable Node kept with the vault comes first (node/bin/node, as Node's
# own download unpacks, or a node program next to this file), so the vault
# can run from a USB drive on a computer that has no Node installed.
NODE=
if [ -x "$DIR/node/bin/node" ]; then NODE=$DIR/node/bin/node
elif [ -f "$DIR/node" ] && [ -x "$DIR/node" ]; then NODE=$DIR/node
elif command -v node >/dev/null 2>&1; then NODE=node
else
  # A window opened by a double-click doesn't always have the PATH a terminal
  # has, so the usual places are looked in too.
  for n in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.local/bin/node"; do
    if [ -x "$n" ]; then NODE=$n; break; fi
  done
fi

if [ -n "$NODE" ]; then
  echo "  Starting with Node on port $VAULT_PORT..."
  "$NODE" "$DIR/serve.js" "$VAULT_PORT" --restart "$@"
  echo
  echo "  Server stopped."
  echo
  exit 0
fi

# Fall back to Python if Node is missing. This serves the page and nothing
# else: python -m http.server knows nothing about /__vault/, so the AI relay
# and the front-end bridge are both dead in this mode. Everything that runs
# in the browser - scanning, tagging, editing - still works.
#
# python -m http.server would serve EVERY file in its folder (the agent's
# workspace, vault.local, .git), so it serves a copy of just the app's own
# files, kept in a temporary folder that is removed when the server stops.
PY=
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' 2>/dev/null; then PY=python
fi

if [ -z "$PY" ]; then
  echo
  echo "  Neither Node.js nor Python 3 was found on this computer."
  echo
  echo "  Node.js is the easier fix - https://nodejs.org  (the LTS version)."
  echo "  If you run SillyTavern, you already have it; this window just"
  echo "  cannot see it, which usually means Node is not on your PATH."
  echo
  exit 1
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/rp-card-vault-web.XXXXXX") || exit 1
trap 'rm -rf "$STAGE"' EXIT
trap 'exit 130' INT TERM HUP
cp "$DIR/RP_Card_Vault.html" "$DIR/manifest.webmanifest" "$DIR/sw.js" "$DIR/icon-192.png" "$DIR/icon-512.png" "$DIR/RP_Card_Vault.ico" "$STAGE/" 2>/dev/null
cp -R "$DIR/lib" "$STAGE/lib" 2>/dev/null
URL="http://127.0.0.1:$VAULT_PORT/RP_Card_Vault.html"
echo "  Node not found - using Python instead."
echo "  WARNING: no /__vault/ relay, so the AI features and the front-end"
echo "           upload bridge will not work. Install Node.js to get them."
echo "  Open: $URL"
case " $* " in
  *" --no-open "*) ;;
  *)
    # Once the server has had a moment to start.
    ( sleep 1
      if command -v open >/dev/null 2>&1; then open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
      fi ) >/dev/null 2>&1 &
    ;;
esac
"$PY" -m http.server "$VAULT_PORT" --bind 127.0.0.1 --directory "$STAGE"
echo
echo "  Server stopped."
echo
