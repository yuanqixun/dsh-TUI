#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SCRIPT_DIR/../tools/node/bin/node" "$SCRIPT_DIR/launch.mjs" "$@"
