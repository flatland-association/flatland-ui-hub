#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$repo_root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
pattern = re.compile(
    r"\b(?:scenario|scenarios|szenario|szenarien|builder|gallery|"
    r"algorithm|algorithms|generator|fehlfunktion|ansichtsanordnung|"
    r"verfahrens-katalog)\b",
    re.IGNORECASE,
)
interpolation = re.compile(r"\{\{.*?\}\}")


def values(value, path=""):
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            yield from values(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from values(child, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value

matches = []
for translation_file in sorted((root / "frontend/public/i18n").glob("*.json")):
    data = json.loads(translation_file.read_text(encoding="utf-8"))
    for path, value in values(data):
        visible_text = interpolation.sub("", value)
        if pattern.search(visible_text):
            matches.append((translation_file.relative_to(root), path, value))

if matches:
    print("Forbidden local terminology found in visible translation values:")
    for file, path, value in matches:
        print(f"{file}:{path}: {value}")
    sys.exit(1)

print("Terminology check passed: no forbidden local terms in visible translations.")
PY
