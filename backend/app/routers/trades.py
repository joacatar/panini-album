from __future__ import annotations

from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps.auth import CurrentUserId, get_current_user_payload, require_verified_email
from app.deps.supabase import get_admin_client
from app.locales import es_419 as t

router = APIRouter(prefix="/trades", tags=["trades"])

VALID_TRANSITIONS = {
    "pendiente": {"aceptado", "cancelado"},
    "aceptado": {"coordinando", "cancelado"},
    "coordinando": {"completado", "cancelado"},
    "completado": set(),
    "cancelado": set(),
}


class TradeCreate(BaseModel):
    receiver_id: UUID
    offer_sticker_ids: list[int] = Field(default_factory=list)
    want_sticker_ids: list[int] = Field(default_factory=list)
    notes: Optional[str] = None


class TradeUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _get_trade(sb, trade_id: str, user_id: UUID) -> dict:
    res = sb.table("trade_requests").select("*").eq("id", trade_id).single().execute()
    if not res.data:
        raise HTTPException(404, t.MSG_TRADE_NOT_FOUND)
    trade = res.data
    uid = str(user_id)
    if trade["requester_id"] != uid and trade["receiver_id"] != uid:
        raise HTTPException(403, t.MSG_TRADE_FORBIDDEN)
    return trade


@router.get("")
def list_my_trades(user_id: CurrentUserId, role: str = "all") -> dict:
    sb = get_admin_client()
    uid = str(user_id)
    q = sb.table("trade_requests").select("*").order("created_at", desc=True)
    if role == "sent":
        q = q.eq("requester_id", uid)
    elif role == "received":
        q = q.eq("receiver_id", uid)
    else:
        q = q.or_(f"requester_id.eq.{uid},receiver_id.eq.{uid}")
    res = q.execute()
    return {"trades": res.data or []}


@router.post("")
def create_trade(
    body: TradeCreate,
    user_id: CurrentUserId,
    token: Annotated[dict, Depends(get_current_user_payload)],
) -> dict:
    require_verified_email(token)
    sb = get_admin_client()
    me = sb.table("profiles").select("profile_complete").eq("id", str(user_id)).single().execute()
    if not me.data or not me.data.get("profile_complete"):
        raise HTTPException(400, t.MSG_PROFILE_INCOMPLETE)
    if str(body.receiver_id) == str(user_id):
        raise HTTPException(400, "No puedes intercambiar contigo mismo.")

    row = {
        "requester_id": str(user_id),
        "receiver_id": str(body.receiver_id),
        "offer_sticker_ids": body.offer_sticker_ids,
        "want_sticker_ids": body.want_sticker_ids,
        "notes": body.notes,
        "status": "pendiente",
    }
    res = sb.table("trade_requests").insert(row).execute()
    if not res.data:
        raise HTTPException(500, "No se pudo crear la solicitud.")
    return {"trade": res.data[0]}


@router.get("/{trade_id}")
def get_trade(trade_id: UUID, user_id: CurrentUserId) -> dict:
    sb = get_admin_client()
    trade = _get_trade(sb, str(trade_id), user_id)
    msgs = (
        sb.table("trade_messages")
        .select("*")
        .eq("trade_id", str(trade_id))
        .order("created_at")
        .execute()
    )
    return {"trade": trade, "messages": msgs.data or []}


@router.patch("/{trade_id}")
def update_trade(trade_id: UUID, body: TradeUpdate, user_id: CurrentUserId) -> dict:
    sb = get_admin_client()
    trade = _get_trade(sb, str(trade_id), user_id)
    updates: dict = {}
    if body.notes is not None:
        updates["notes"] = body.notes
    if body.status:
        current = trade["status"]
        if body.status not in VALID_TRANSITIONS.get(current, set()):
            raise HTTPException(400, f"No puedes cambiar de {current} a {body.status}.")
        updates["status"] = body.status
    if not updates:
        return {"trade": trade}
    res = sb.table("trade_requests").update(updates).eq("id", str(trade_id)).execute()
    return {"trade": (res.data or [trade])[0]}


@router.post("/{trade_id}/messages")
def post_message(trade_id: UUID, body: MessageCreate, user_id: CurrentUserId) -> dict:
    sb = get_admin_client()
    _get_trade(sb, str(trade_id), user_id)
    row = {
        "trade_id": str(trade_id),
        "sender_id": str(user_id),
        "body": body.body.strip(),
    }
    res = sb.table("trade_messages").insert(row).execute()
    return {"message": (res.data or [row])[0]}
