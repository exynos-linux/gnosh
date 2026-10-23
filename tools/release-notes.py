#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Print the CHANGELOG.md section for a version, plus install instructions."""
import re
import sys
from pathlib import Path

version = sys.argv[1]
text = (Path(__file__).resolve().parents[1] / "CHANGELOG.md").read_text()
m = re.search(rf"^## {re.escape(version)}\b.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
body = m.group(1).strip() if m else f"gnosh {version}"
print(body)
print(f"""
### Install

```sh
curl -fsSL https://raw.githubusercontent.com/exynos-linux/gnosh/main/setup.sh | sh
```

or `gnosh self-update` if gnosh is installed. `gnosh-{version}.tar.gz` contains
everything; `gnosh.tar.gz` is the same file under a fixed name for
`releases/latest/download/`.""")
