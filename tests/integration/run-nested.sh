#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Run tests/integration/run-phosh.sh inside the gnosh test container.
#   run-nested.sh OUTDIR [STEPS_FILE]
# Environment: EXTENSIONS, EXT_SRC (host path, mounted at /ext), IMAGE.
set -eu
here=$(cd "$(dirname "$0")/../.." && pwd)
out=$1; shift
mkdir -p "$out"
IMAGE=${IMAGE:-gnosh-test-pmos}
steps_arg=""
mounts="-v $here:/gnosh:ro -v $out:/out"
if [ $# -gt 0 ]; then
    cp "$1" "$out/steps.sh"
    steps_arg=/out/steps.sh
fi
if [ -n "${EXT_SRC:-}" ]; then
    mounts="$mounts -v $EXT_SRC:/ext:ro"
fi
# shellcheck disable=SC2086 # $mounts and $steps_arg are word lists
exec podman run --rm --userns=keep-id --security-opt seccomp=unconfined --security-opt label=disable \
    -e EXTENSIONS="${EXTENSIONS:-}" -e EXT_SRC="${EXT_SRC:+/ext}" \
    $mounts "$IMAGE" /gnosh/tests/integration/run-phosh.sh $steps_arg
