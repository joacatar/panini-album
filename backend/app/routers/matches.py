from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.deps.auth import CurrentUserId
from app.deps.supabase import get_admin_client
from app.services.geo import haversine_km
from app.services.matching import build_match_row

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("")
def list_matches(
    user_id: CurrentUserId,
    filter: str = Query("cerca", pattern="^(cerca|ciudad|pais|todos)$"),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    sb = get_admin_client()

    me = (
        sb.table("profiles")
        .select("*")
        .eq("id", str(user_id))
        .single()
        .execute()
    )
    if not me.data:
        raise HTTPException(404, "Perfil no encontrado.")
    profile = me.data
    if not profile.get("profile_complete"):
        raise HTTPException(400, "Completa tu ubicación antes de explorar.")

    all_stickers = sb.table("stickers").select("id, number").execute()
    sticker_to_number = {s["id"]: s["number"] for s in (all_stickers.data or [])}
    all_numbers = set(sticker_to_number.values())

    def parse_collection(rows: list) -> tuple[set[int], set[int]]:
        duplicates: set[int] = set()
        owned: set[int] = set()
        for row in rows or []:
            num = sticker_to_number.get(row["sticker_id"])
            if not num:
                continue
            if row.get("owned"):
                owned.add(num)
            if (row.get("duplicates") or 0) > 0:
                duplicates.add(num)
        return duplicates, owned

    my_rows = (
        sb.table("user_stickers")
        .select("sticker_id, owned, duplicates")
        .eq("user_id", str(user_id))
        .execute()
    )
    my_duplicates, my_owned = parse_collection(my_rows.data)
    my_missing = all_numbers - my_owned

    others = (
        sb.table("profiles")
        .select("id, display_name, city, country, lat, lng, search_radius_km")
        .eq("profile_complete", True)
        .neq("id", str(user_id))
        .execute()
    )

    results: list[dict] = []
    my_lat, my_lng = profile.get("lat"), profile.get("lng")
    my_city = (profile.get("city") or "").lower()
    my_country = (profile.get("country") or "").lower()
    my_radius = profile.get("search_radius_km") or 25

    for other in others.data or []:
        oid = other["id"]
        if filter == "ciudad" and (other.get("city") or "").lower() != my_city:
            continue
        if filter == "pais" and (other.get("country") or "").lower() != my_country:
            continue

        dist = haversine_km(my_lat, my_lng, other.get("lat"), other.get("lng"))
        if filter == "cerca":
            if dist is None:
                continue
            max_r = max(my_radius, other.get("search_radius_km") or 25)
            if dist > max_r:
                continue

        their_rows = (
            sb.table("user_stickers")
            .select("sticker_id, owned, duplicates")
            .eq("user_id", oid)
            .execute()
        )
        their_duplicates, their_owned = parse_collection(their_rows.data)
        their_missing = all_numbers - their_owned

        if not their_duplicates and not their_missing:
            continue

        match = build_match_row(
            oid,
            other.get("display_name") or "Coleccionista",
            other.get("city") or "",
            other.get("country") or "",
            dist,
            my_duplicates,
            my_missing,
            their_duplicates,
            their_missing,
        )
        if match["match_score"] > 0 or filter in ("ciudad", "pais", "todos"):
            results.append(match)

    results.sort(key=lambda x: (-x["match_score"], x["distance_km"] if x["distance_km"] is not None else 99999))
    return {"matches": results[:limit], "filter": filter}
