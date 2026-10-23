#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Download GNOME Shell extensions (the builds gnosh would pick) into a cache.

  tools/fetch-extensions.py CACHE_DIR UUID...
"""
import importlib.machinery
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("gnosh_cli", str(ROOT / "bin" / "gnosh"))
spec = importlib.util.spec_from_loader("gnosh_cli", loader)
gnosh = importlib.util.module_from_spec(spec)
loader.exec_module(gnosh)


def main():
    cache = Path(sys.argv[1])
    cache.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for uuid in sys.argv[2:]:
        try:
            info = gnosh.ego_info(uuid)
        except Exception as e:  # noqa: BLE001
            print(f"{uuid}: not found ({e})")
            continue
        build = gnosh.pick_build(info.get("shell_version_map"))
        if not build:
            print(f"{uuid}: no build for GNOME 45-51")
            manifest[uuid] = {"name": info.get("name"), "error": "no GNOME 45-51 build"}
            continue
        data = gnosh.http_get(f"{gnosh.EGO}/download-extension/{uuid}.shell-extension.zip?version_tag={build['pk']}")
        target = cache / uuid
        if target.exists():
            import shutil
            shutil.rmtree(target)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            gnosh.safe_extract(zf, target)
        manifest[uuid] = {"name": info.get("name"), "version": build.get("version"), "shell": build["shell"],
                          "link": f"{gnosh.EGO}{info.get('link', '')}", "downloads": info.get("downloads")}
        print(f"{uuid}: {info.get('name')} v{build.get('version')} (GNOME {build['shell']})")
    old = {}
    mpath = cache / "manifest.json"
    if mpath.exists():
        old = json.loads(mpath.read_text())
    old.update(manifest)
    mpath.write_text(json.dumps(old, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
