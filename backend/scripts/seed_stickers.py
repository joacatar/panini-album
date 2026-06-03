#!/usr/bin/env python3
"""Genera supabase/seed/panini_2026_full.sql desde backend/data/panini_2026.json"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend" / "data" / "panini_2026.json"
OUT = ROOT / "supabase" / "seed" / "panini_2026_full.sql"


def main() -> None:
    stickers = json.loads(DATA.read_text(encoding="utf-8"))
    cols = (
        "number, code, name, section, team_code, team_name, team_slot, "
        "sticker_kind, sticker_type, display_order"
    )
    lines = [f"INSERT INTO public.stickers ({cols}) VALUES"]
    rows = []
    for s in stickers:
        name = s["name"].replace("'", "''")
        section = s["section"].replace("'", "''")
        team_name = s.get("team_name", "").replace("'", "''")
        team_slot = s.get("team_slot")
        ts = "NULL" if team_slot is None else str(team_slot)
        rows.append(
            f"({s['number']}, '{s['code']}', '{name}', '{section}', "
            f"'{s['team_code']}', '{team_name}', {ts}, "
            f"'{s['sticker_kind']}', '{s['sticker_type']}', {s['display_order']})"
        )
    lines.append(",\n".join(rows))
    lines.append("ON CONFLICT (number) DO UPDATE SET")
    lines.append(
        "  code = EXCLUDED.code, name = EXCLUDED.name, section = EXCLUDED.section,"
    )
    lines.append(
        "  team_code = EXCLUDED.team_code, team_name = EXCLUDED.team_name,"
    )
    lines.append(
        "  team_slot = EXCLUDED.team_slot, sticker_kind = EXCLUDED.sticker_kind,"
    )
    lines.append(
        "  sticker_type = EXCLUDED.sticker_type, display_order = EXCLUDED.display_order;"
    )
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(stickers)} stickers to {OUT}")


if __name__ == "__main__":
    main()
