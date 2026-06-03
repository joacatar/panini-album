from __future__ import annotations

def count_mutual_matches(
    my_duplicates: set[int],
    my_missing: set[int],
    their_duplicates: set[int],
    their_missing: set[int],
) -> tuple[int, list[int], list[int]]:
    """Cuántas láminas puedo darles / ellos me pueden dar (por número de lámina)."""
    i_offer = sorted(my_duplicates & their_missing)
    they_offer = sorted(their_duplicates & my_missing)
    score = len(i_offer) + len(they_offer)
    return score, i_offer, they_offer


def build_match_row(
    user_id: str,
    display_name: str,
    city: str,
    country: str,
    distance_km: float | None,
    my_duplicates: set[int],
    my_missing: set[int],
    their_duplicates: set[int],
    their_missing: set[int],
) -> dict:
    score, i_offer, they_offer = count_mutual_matches(
        my_duplicates, my_missing, their_duplicates, their_missing
    )
    return {
        "user_id": user_id,
        "display_name": display_name,
        "city": city,
        "country": country,
        "distance_km": distance_km,
        "match_score": score,
        "you_offer_numbers": i_offer,
        "they_offer_numbers": they_offer,
    }
