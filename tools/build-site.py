#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the gnosh website (GitHub Pages) from site/ and the test results.

  tools/build-site.py --out _site
"""
import argparse
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"

LAYOUT = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="gnosh runs GNOME Shell extensions inside Phosh, the GNOME mobile shell.">
<link rel="stylesheet" href="style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧩</text></svg>">
</head>
<body>
<header class="top"><div class="inner">
  <a class="brand" href="index.html">gnosh</a>
  <nav>{nav}</nav>
</div></header>
<main>
{content}
</main>
<footer><div class="inner">
  gnosh {version} · <a href="https://github.com/exynos-linux/gnosh">GitHub</a> ·
  <a href="https://github.com/exynos-linux/gnosh/releases">Releases</a> ·
  <a href="https://github.com/exynos-linux/gnosh/issues">Issues</a> ·
  GPL-3.0-or-later · includes code from GNOME Shell (GPL-2.0-or-later)
</div></footer>
</body>
</html>
"""

PAGES = [("index.html", "Home"), ("compatibility.html", "Compatibility"), ("docs.html", "Documentation")]


def esc(s):
    return html.escape(str(s if s is not None else ""))


def extension_table(results, compat):
    order = {"works": 0, "partial": 1, "environment": 2, "fails": 3, "unsupported": 4}
    rows = sorted(results.get("extensions", []),
                  key=lambda r: (order.get(r.get("result"), 9), (r.get("name") or r["uuid"]).lower()))
    out = ["<table><tr><th>Extension</th><th>Status</th><th>In Phosh</th><th>Notes</th><th>Screenshot</th></tr>"]
    for r in rows:
        res = r.get("result", "fails")
        where = []
        if r.get("topbar"):
            where.append("top bar")
        if r.get("tiles"):
            where.append("tile: " + ", ".join(esc(t) for t in r["tiles"]))
        notes = []
        if r.get("functional"):
            notes.append(esc(r["functional"]))
        if r.get("notes_manual"):
            notes.append(esc(r["notes_manual"]))
        if res == "unsupported":
            notes.append(esc(compat.get("incompatible", {}).get(r["uuid"], r.get("notes", ""))))
        elif r.get("error"):
            notes.append(f"<span class='small'>{esc(r['error'][:240])}</span>")
        elif r.get("notes"):
            notes.append(esc(r["notes"]))
        if r.get("device"):
            notes.append(f"<strong>Device:</strong> {esc(r['device'])}")
        shot = ""
        if r.get("screenshot"):
            shot = f"<a href='{esc(r['screenshot'])}'><img class='thumb' src='{esc(r['screenshot'])}' alt='' loading='lazy'></a>"
        ego = f"https://extensions.gnome.org/extension-info/?uuid={esc(r['uuid'])}"
        version = f" v{esc(r['version'])}" if r.get("version") else ""
        out.append(
            f"<tr><td><strong>{esc(r.get('name') or r['uuid'])}</strong>{version}<br>"
            f"<span class='small'><a href='{ego}'>{esc(r['uuid'])}</a></span></td>"
            f"<td><span class='badge {esc(res)}'>{esc(res)}</span></td>"
            f"<td>{'<br>'.join(where) or '—'}</td><td>{'<br>'.join(notes)}</td><td>{shot}</td></tr>")
    out.append("</table>")
    return "\n".join(out)


def summary(results):
    counts = {}
    for r in results.get("extensions", []):
        counts[r.get("result", "fails")] = counts.get(r.get("result", "fails"), 0) + 1
    order = ["works", "partial", "environment", "fails", "unsupported"]
    total = sum(counts.values())
    parts = [f"<span><strong>{total}</strong> extensions tested</span>"]
    parts += [f"<span class='badge {k}'>{counts[k]} {k}</span>" for k in order if counts.get(k)]
    return " ".join(parts)


def distro_table(distros):
    out = ["<table><tr><th>Distribution</th><th>Phosh</th><th>gjs</th><th>Phosh unit</th><th>Status</th><th>Notes</th></tr>"]
    for d in distros.get("distros", []):
        out.append(f"<tr><td>{esc(d['name'])}</td><td>{esc(d['phosh'])}</td><td>{esc(d['gjs'])}</td>"
                   f"<td><code>{esc(d['unit'])}</code></td><td><span class='badge {esc(d['status'])}'>{esc(d['status'])}</span></td>"
                   f"<td>{esc(d.get('notes', ''))}</td></tr>")
    out.append("</table>")
    return "\n".join(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="_site")
    args = p.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    version = (ROOT / "VERSION").read_text().strip()
    try:
        results = json.loads((ROOT / "tests" / "results" / "extensions.json").read_text())
    except (OSError, ValueError):
        results = {"extensions": []}
    distros = json.loads((ROOT / "tests" / "results" / "distros.json").read_text())
    compat = json.loads((ROOT / "runtime" / "data" / "compat.json").read_text())
    env = sorted({r.get("environment", "") for r in results.get("extensions", []) if r.get("environment")})

    values = {
        "version": esc(version),
        "extension_table": extension_table(results, compat),
        "distro_table": distro_table(distros),
        "summary": summary(results),
        "generated": esc(results.get("generated", "")),
        "environment": esc("; ".join(env) or "n/a"),
    }

    for name, label in PAGES:
        src = (SITE / name).read_text()
        m = re.match(r"<!--\s*title:\s*(.*?)\s*-->\s*", src)
        title = m.group(1) if m else f"{label} · gnosh"
        body = src[m.end():] if m else src
        for key, value in values.items():
            body = body.replace("{{" + key + "}}", value)
        nav = " ".join(f"<a href='{n}'{' class=\"active\"' if n == name else ''}>{lbl}</a>" for n, lbl in PAGES)
        nav += " <a href='https://github.com/exynos-linux/gnosh'>GitHub</a>"
        (out / name).write_text(LAYOUT.format(title=esc(title), nav=nav, content=body, version=esc(version)))

    shutil.copy(SITE / "style.css", out / "style.css")
    shutil.copytree(SITE / "img", out / "img")
    shutil.copy(ROOT / "setup.sh", out / "setup.sh")
    (out / ".nojekyll").write_text("")
    print(f"site written to {out}")


if __name__ == "__main__":
    main()
