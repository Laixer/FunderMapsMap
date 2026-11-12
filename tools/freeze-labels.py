#!/usr/bin/env python3
"""The Dutch labels of the building panel, taken from the current map app (FunderMapsWebFront) so both say the same.

  python3 tools/freeze-labels.py <WebFront>/src  >  src/panel/labels.json

- enums: per enum, the label of each value by its wire name (snake_case of the enum key, as the API sends it).
  Never by position: the values are matched by name.
- fields: per record kind, the label of each field by its camelCase name.
"""
import json, re, sys
from pathlib import Path

src = Path(sys.argv[1])
snake = lambda s: re.sub(r"([a-z])([A-Z])", r"\1_\2", s).lower()

enums = {}
for f in sorted((src / "datastructures/enums").glob("E*.ts")):
    text = f.read_text()
    for name, body in re.findall(r"export const (E\w+)Labels[^=]*=\s*new Map(?:<[^>]*>)?\(\s*\[(.*?)\]\s*\)", text, re.S):
        pairs = re.findall(r"\[\s*" + name + r"\.(\w+)\s*,\s*([\"'])(.*?)\2\s*\]", body)
        if pairs:
            enums[name[1:]] = {snake(k): label for k, _, label in pairs}

fields = {}
text = (src / "datastructures/fieldLabels.ts").read_text()
for name, body in re.findall(r"export const (\w+)FieldLabels\s*=\s*<Record<string, string>>\s*\{([^}]*)\}", text):
    pairs = re.findall(r"^\s*(\w+)\s*:\s*([\"'])(.*?)\2\s*,?\s*$", body, re.M)
    if pairs:
        fields[name[0].lower() + name[1:]] = {k: label for k, _, label in pairs}

json.dump({"enums": enums, "fields": fields}, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
sys.stdout.write("\n")
