#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Run a test script inside the gnosh test container as a fresh user.
#   container-run.sh SCRIPT OUTDIR [ENV=VALUE...]

set -euo pipefail

here=$(cd "$(dirname "$0")/../.." && pwd)
script=$1
out=$2
shift 2
mkdir -p "$out"

env_args=()
for kv in "$@"; do
    env_args+=("-e" "$kv")
done

IMAGE=${IMAGE:-gnosh-test-pmos}

exec podman run --rm \
    --userns=keep-id:uid=1000,gid=1000 \
    --security-opt seccomp=unconfined \
    --security-opt label=disable \
    -v "$here:/gnosh:ro" \
    -v "$out:/out" \
    "${env_args[@]}" \
    "$IMAGE" "/gnosh/$script"
