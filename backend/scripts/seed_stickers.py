#!/usr/bin/env python3
"""Genera supabase/seed/panini_2026_full.sql desde backend/data/panini_2026.json"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend" / "data" / "panini_2026.json"
OUT = ROOT / "supabase" / "seed" / "panini_2026_full.sql"


def main() -> None:
    stickers = json.loads(DATA.read_text(encoding="utf-8"))
    lines = ["INSERT INTO public.stickers (number, name, section, sticker_type) VALUES"]
    rows = []
    for s in stickers:
        name = s["name"].replace("'", "''")
        section = s["section"].replace("'", "''")
        rows.append(
            f"({s['number']}, '{name}', '{section}', '{s['sticker_type']}')"
        )
    lines.append(",\n".join(rows))
    lines.append("ON CONFLICT (number) DO NOTHING;")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(stickers)} stickers to {OUT}")


if __name__ == "__main__":
    main()
