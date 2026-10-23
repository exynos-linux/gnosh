#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copy this checkout to a Phosh device and run run-headless.sh there.
#   test-on-device.sh root@HOST USER OUTDIR ["UUID ..."]
# Set LOCK=/path/to/lockfile to serialize access to a shared device.
set -eu
here=$(cd "$(dirname "$0")/../.." && pwd)
host=$1; user=$2; out=$3; install=${4:-}
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$here" archive --format=tar.gz --prefix=gnosh/ -o "$tmp/gnosh.tar.gz" HEAD
lock() { if [ -n "${LOCK:-}" ]; then flock -w 300 "$LOCK" "$@"; else "$@"; fi; }
lock scp -q "$tmp/gnosh.tar.gz" "$here/tests/device/run-headless.sh" "$host:/tmp/"
lock ssh "$host" "sh /tmp/run-headless.sh $user /tmp/gnosh.tar.gz '$install'" | tee "$out/device.log"
lock scp -q "$host:/tmp/gnosh-device-test/out/*" "$out/" || true
lock ssh "$host" "rm -rf /tmp/gnosh-device-test /tmp/gnosh.tar.gz /tmp/run-headless.sh"
