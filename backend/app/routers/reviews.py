from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.deps.auth import CurrentUserId
from app.deps.supabase import get_admin_client
from app.locales import es_419 as t

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1000)


class ReportCreate(BaseModel):
    reported_user_id: UUID
    reason: str = Field(min_length=3, max_length=200)
    details: Optional[str] = Field(default=None, max_length=2000)


@router.post("/trades/{trade_id}")
def create_review(trade_id: UUID, body: ReviewCreate, user_id: CurrentUserId) -> dict:
    sb = get_admin_client()
    trade_res = sb.table("trade_requests").select("*").eq("id", str(trade_id)).single().execute()
    if not trade_res.data:
        raise HTTPException(404, t.MSG_TRADE_NOT_FOUND)
    trade = trade_res.data
    uid = str(user_id)
    if uid not in (trade["requester_id"], trade["receiver_id"]):
        raise HTTPException(403, t.MSG_REVIEW_NOT_PARTICIPANT)
    if trade["status"] != "completado":
        raise HTTPException(400, t.MSG_REVIEW_ONLY_COMPLETED)

    reviewee = trade["receiver_id"] if trade["requester_id"] == uid else trade["requester_id"]
    existing = (
        sb.table("reviews")
        .select("id")
        .eq("trade_id", str(trade_id))
        .eq("reviewer_id", uid)
        .execute()
    )
    if existing.data:
        raise HTTPException(400, t.MSG_REVIEW_ALREADY)

    row = {
        "trade_id": str(trade_id),
        "reviewer_id": uid,
        "reviewee_id": reviewee,
        "rating": body.rating,
        "comment": body.comment.strip(),
    }
    res = sb.table("reviews").insert(row).execute()
    return {"review": (res.data or [row])[0]}


@router.get("/users/{profile_id}")
def list_user_reviews(profile_id: UUID) -> dict:
    sb = get_admin_client()
    reviews = (
        sb.table("reviews")
        .select("*")
        .eq("reviewee_id", str(profile_id))
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    rating = (
        sb.table("profile_ratings")
        .select("*")
        .eq("user_id", str(profile_id))
        .maybe_single()
        .execute()
    )
    avg = rating.data.get("avg_rating") if rating.data else None
    count = rating.data.get("review_count") if rating.data else 0
    return {
        "reviews": reviews.data or [],
        "avg_rating": float(avg) if avg else None,
        "review_count": count or 0,
    }


@router.post("/reports")
def create_report(body: ReportCreate, user_id: CurrentUserId) -> dict:
    sb = get_admin_client()
    if str(body.reported_user_id) == str(user_id):
        raise HTTPException(400, "No puedes reportarte a ti mismo.")
    row = {
        "reporter_id": str(user_id),
        "reported_user_id": str(body.reported_user_id),
        "reason": body.reason.strip(),
        "details": body.details,
    }
    res = sb.table("reports").insert(row).execute()
    return {"report": (res.data or [row])[0], "message": "Reporte enviado. Lo revisaremos pronto."}
