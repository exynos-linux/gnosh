#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Summarize tests/integration/matrix.sh output into tests/results/extensions.json.

  tools/matrix-summary.py MATRIX_OUT EXT_CACHE [--env "postmarketOS edge, Phosh 0.58 (container)"]
"""
import argparse
import ast
import datetime
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("cache")
p.add_argument("--env", default="postmarketOS edge (Nura), Phosh 0.58, GJS 1.90, headless phoc in a container")
p.add_argument("--results", default=str(ROOT / "tests" / "results" / "extensions.json"))
p.add_argument("--shots", default=str(ROOT / "site" / "img" / "matrix"))
args = p.parse_args()

out = Path(args.out)
manifest = json.loads((Path(args.cache) / "manifest.json").read_text())
compat = json.loads((ROOT / "runtime" / "data" / "compat.json").read_text())
try:
    existing = {e["uuid"]: e for e in json.loads(Path(args.results).read_text())["extensions"]}
except (OSError, ValueError, KeyError):
    existing = {}
shots = Path(args.shots)
shots.mkdir(parents=True, exist_ok=True)

rows = []
for d in sorted(p for p in out.iterdir() if p.is_dir()):
    uuid = d.name
    status_file = d / "status.txt"
    row = {"uuid": uuid, "name": manifest.get(uuid, {}).get("name", uuid),
           "version": manifest.get(uuid, {}).get("version"), "build": manifest.get(uuid, {}).get("shell"),
           "tested": datetime.date.today().isoformat(), "environment": args.env}
    try:
        data = json.loads(ast.literal_eval(status_file.read_text().strip())[0])
    except Exception:  # noqa: BLE001
        row.update(state="NO-ANSWER", result="fails", notes="gnosh did not answer after loading this extension")
        rows.append(row)
        continue
    ext = next((e for e in data["extensions"] if e["uuid"] == uuid), None)
    row["state"] = ext["state"] if ext else "MISSING"
    row["error"] = ext.get("error") if ext else None
    tiles = [t for t in data["tiles"] if t.get("uuid") == uuid]
    topbar = [t for t in data.get("topbar", []) if t.get("uuid") == uuid and t.get("visible")]
    row["tiles"] = [t["label"] for t in tiles]
    row["topbar"] = bool(topbar)
    log = (d / "phosh.log").read_text(errors="replace") if (d / "phosh.log").exists() else ""
    errors = [l for l in log.splitlines() if "JS ERROR" in l and "Gio.IOErrorEnum: Could not connect" not in l]
    row["jsErrors"] = len(errors)
    row["dialogs"] = (d / "dialogs.txt").read_text().strip() if (d / "dialogs.txt").exists() else ""
    if uuid in compat["incompatible"]:
        row["result"] = "unsupported"
        row["notes"] = compat["incompatible"][uuid]
    elif row["state"] == "ACTIVE":
        row["result"] = "works" if (tiles or topbar) and not errors else "partial"
    else:
        row["result"] = "fails"
    page = d / "page.png"
    if page.exists() and row["result"] != "unsupported":
        target = shots / f"{re.sub(r'[^A-Za-z0-9._-]', '_', uuid)}.png"
        shutil.copy(page, target)
        row["screenshot"] = f"img/matrix/{target.name}"
    old = existing.get(uuid, {})
    for key in ("functional", "notes_manual", "device"):
        if key in old:
            row[key] = old[key]
    rows.append(row)

Path(args.results).parent.mkdir(parents=True, exist_ok=True)
Path(args.results).write_text(json.dumps({"generated": datetime.date.today().isoformat(), "extensions": rows},
                                         indent=2, ensure_ascii=False) + "\n")
counts = {}
for r in rows:
    counts[r["result"]] = counts.get(r["result"], 0) + 1
print(counts)
for r in rows:
    print(f"{r['result']:12} {r.get('state', ''):12} {r['uuid']:55} tiles={r.get('tiles')} topbar={r.get('topbar')} err={r.get('jsErrors')} {(r.get('error') or '')[:90]}")
