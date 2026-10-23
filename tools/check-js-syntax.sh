#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Syntax-check every gnosh JS module (ES modules) with node --check.
set -eu
status=0
find runtime -name '*.js' | sort | while read -r f; do
    node --check "$f" 2>/dev/null || { echo "syntax error: $f" >&2; node --check "$f" || true; exit 1; }
done || status=1
exit $status
