#!/usr/bin/env bash
# Starts Bearly Apart from this folder (used by the app launcher).
cd "$(dirname "${BASH_SOURCE[0]}")"
exec ./node_modules/electron/dist/electron . --ozone-platform=x11 "$@"
