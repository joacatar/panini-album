#!/usr/bin/env python3
"""Genera catálogo Panini WC 2026: FWC + 48 selecciones."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT = DATA_DIR / "panini_2026.json"
TEAMS_JSON = DATA_DIR / "wc2026_teams.json"
FLAGS_OUT = ROOT.parent / "frontend" / "src" / "lib" / "teamFlags.js"

FWC_ITEMS = [
    (1, "Emblema oficial", "special"),
    (2, "Trofeo FIFA", "shiny"),
    (3, "Mascota del torneo", "normal"),
    (4, "Póster del Mundial", "normal"),
    (5, "Historia FWC 1", "normal"),
    (6, "Historia FWC 2", "normal"),
    (7, "México sede", "shiny"),
    (8, "Estadio Ciudad de México", "normal"),
    (9, "Estadio Guadalajara", "normal"),
    (10, "Estadio Monterrey", "normal"),
    (11, "USA sede", "normal"),
    (12, "Canadá sede", "normal"),
    (13, "FWC Leyenda 1", "shiny"),
    (14, "FWC Leyenda 2", "normal"),
    (15, "FWC Leyenda 3", "normal"),
    (16, "FWC Leyenda 4", "special"),
    (17, "FWC Leyenda 5", "normal"),
    (18, "FWC Leyenda 6", "normal"),
    (19, "FWC Leyenda 7", "shiny"),
    (20, "FWC Leyenda 8", "normal"),
]


def default_roster(team_name: str) -> list[str]:
    return [
        "Escudo / Emblema",
        "Portero titular",
        "Defensa central 1",
        "Defensa central 2",
        "Lateral derecho",
        "Lateral izquierdo",
        "Mediocampista 1",
        "Mediocampista 2",
        "Mediocampista 3",
        "Medio ofensivo",
        "Extremo derecho",
        "Extremo izquierdo",
        "Foto de equipo",
        "Delantero centro",
        "Segundo delantero",
        "Volante mixto",
        "Defensa alterno",
        "Medio alterno",
        "Delantero alterno",
        f"Estrella {team_name}",
    ]


def kind_for_slot(slot: int, label: str) -> str:
    if slot == 1 or "Escudo" in label or "Emblema" in label:
        return "escudo"
    if slot == 13 or "Foto" in label:
        return "foto_equipo"
    return "jugador"


def sticker_type_for(kind: str, slot: int) -> str:
    if kind == "escudo":
        return "shiny"
    if kind == "foto_equipo":
        return "special"
    if slot in (10, 15, 17):
        return "shiny"
    return "normal"


def load_teams() -> list[dict]:
    raw = json.loads(TEAMS_JSON.read_text(encoding="utf-8"))
    hosts = {"MEX", "USA", "CAN"}
    host_teams = [t for t in raw if t["code"] in hosts]
    other = [t for t in raw if t["code"] not in hosts]
    other.sort(key=lambda t: t["name"].lower())
    return host_teams + other


def build() -> list[dict]:
    stickers: list[dict] = []
    number = 1
    order = 0

    for slot, name, stype in FWC_ITEMS:
        stickers.append(
            {
                "number": number,
                "code": f"FWC{slot}",
                "name": name,
                "section": "FWC",
                "team_code": "FWC",
                "team_name": "FIFA World Cup",
                "team_slot": slot,
                "team_page": 1 if slot <= 10 else 2,
                "sticker_kind": "fwc",
                "sticker_type": stype,
                "display_order": order,
            }
        )
        number += 1
        order += 1

    for team in load_teams():
        players = team.get("players") or default_roster(team["name"])
        if len(players) != 20:
            raise ValueError(f"{team['code']} debe tener 20 láminas, tiene {len(players)}")
        for slot, label in enumerate(players, start=1):
            kind = kind_for_slot(slot, label)
            stickers.append(
                {
                    "number": number,
                    "code": f"{team['code']}{slot}",
                    "name": label if slot > 1 else f"Escudo {team['name']}",
                    "section": team["name"],
                    "team_code": team["code"],
                    "team_name": team["name"],
                    "team_slot": slot,
                    "team_page": 1 if slot <= 10 else 2,
                    "sticker_kind": kind,
                    "sticker_type": sticker_type_for(kind, slot),
                    "display_order": order,
                    "flag": team["flag"],
                }
            )
            number += 1
            order += 1

    return stickers


def write_team_flags(teams: list[dict]) -> None:
    flags = {"FWC": "🏆"}
    for t in teams:
        flags[t["code"]] = t["flag"]
    lines = [
        "// Generado por backend/scripts/generate_catalog.py — no editar a mano",
        "export const TEAM_FLAGS = " + json.dumps(flags, ensure_ascii=False, indent=2) + ";",
        "",
    ]
    FLAGS_OUT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    teams = load_teams()
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    write_team_flags(teams)
    print(f"Wrote {len(data)} stickers → {OUT}")
    print(f"Wrote {len(teams) + 1} team flags → {FLAGS_OUT}")


if __name__ == "__main__":
    main()
