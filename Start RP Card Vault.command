#!/bin/sh
# Starts RP Card Vault on a Mac: double-click this file in Finder.
#
# A Terminal window opens and stays open while the vault runs; closing it (or
# Ctrl+C in it) stops the server. This only runs start.sh, which sits next to
# it and does the work.
#
# The first time, macOS may refuse to open a file that came from the internet.
# Right-click it, choose Open, and confirm: it is remembered after that.

cd "$(dirname "$0")" || exit 1
exec sh ./start.sh "$@"
