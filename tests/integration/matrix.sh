#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Test each extension on its own in headless Phosh.
#   matrix.sh EXT_CACHE OUTDIR [UUID...]   (default: tests/integration/matrix-extensions.txt)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cache=$1
out=$2
shift 2
if [ $# -gt 0 ]; then
    list="$*"
else
    list=$(grep -v '^#' "$here/matrix-extensions.txt")
fi
for uuid in $list; do
    echo "=== $uuid"
    rm -rf "${out:?}/$uuid"
    EXT_SRC="$cache" EXTENSIONS="$uuid" timeout 240 "$here/run-nested.sh" "$out/$uuid" "$here/steps/matrix.sh" \
        > "$out/$uuid.log" 2>&1 || echo "  (run failed: $?)"
    grep -E "JS ERROR|signal" "$out/$uuid.log" | head -3 || true
done
