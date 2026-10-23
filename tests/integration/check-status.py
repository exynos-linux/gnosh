#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check a gnosh GetStatus dump: listed extensions must be ACTIVE."""
import argparse
import ast
import json
import sys

p = argparse.ArgumentParser()
p.add_argument("status")
p.add_argument("--active", nargs="*", default=[])
args = p.parse_args()
text = open(args.status).read().strip()
try:
    data = json.loads(ast.literal_eval(text)[0])
except Exception as e:  # noqa: BLE001
    sys.exit(f"cannot parse status ({e}): {text[:300]}")
states = {e["uuid"]: e for e in data["extensions"]}
failed = False
for uuid in args.active:
    e = states.get(uuid)
    state = e["state"] if e else "MISSING"
    print(f"{state:12} {uuid} {e.get('error') or '' if e else ''}")
    failed |= state != "ACTIVE"
print(f"tiles: {[t['label'] for t in data['tiles']]}")
sys.exit(1 if failed else 0)
