from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_crc, require_dn
from app.core.database import get_db
from app.models.order import Order, OrderAck
from app.models.user import User
from app.schemas.order import OrderAckUpdate, OrderCreate, OrderExecuteUpdate, OrderOut
from app.services.websocket import manager

router = APIRouter(prefix="/orders", tags=["orders"])


def _next_ref(order_type: str, db: Session) -> str:
    now = datetime.now(timezone.utc)
    prefix = "URG" if order_type == "urgence" else "REA"
    count = db.query(Order).filter(Order.order_type == order_type).count() + 1
    return f"{prefix}-{now.year}-{now.month:02d}{now.day:02d}-{count:03d}"


@router.get("", response_model=list[OrderOut])
def list_orders(
    order_type: str | None = None,
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Order)
    if order_type:
        q = q.filter(Order.order_type == order_type)
    if status:
        q = q.filter(Order.status == status)
    return q.order_by(Order.issued_at.desc()).limit(limit).all()


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(
    body: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dn),
):
    """DN emits an urgence or réalimentation order."""

    # Contra-order: if a realim order arrives while urgence pending → cancel active urgences
    # If an urgence arrives while realim pending → cancel active realims
    if body.order_type == "urgence":
        active_realims = db.query(Order).filter(
            Order.order_type == "realim",
            Order.status.in_(["pending", "acknowledged", "executing"]),
        ).all()
        for r in active_realims:
            r.status = "cancelled"
            r.cancelled_at = datetime.now(timezone.utc)
    elif body.order_type == "realim":
        active_urgences = db.query(Order).filter(
            Order.order_type == "urgence",
            Order.status.in_(["pending", "acknowledged", "executing"]),
        ).all()
        # Only cancel if they are fully resolved; otherwise note the contra-order
        # (operational decision: urgence always takes priority)

    order = Order(
        order_ref=_next_ref(body.order_type, db),
        order_type=body.order_type,
        sub_type=body.sub_type,
        mw_total=body.mw_total,
        mw_nord=body.mw_nord,
        mw_sud=body.mw_sud,
        issued_by=current_user.id,
        target_crc_id=body.target_crc_id,
        notes=body.notes,
        status="pending",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # Broadcast to all connected CRC/BCC clients via WebSocket
    await manager.broadcast(
        {
            "event": "new_order",
            "order_type": order.order_type,
            "order_ref": order.order_ref,
            "mw_total": order.mw_total,
            "mw_nord": order.mw_nord,
            "mw_sud": order.mw_sud,
            "status": order.status,
            "issued_at": order.issued_at.isoformat(),
        }
    )

    return order


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable")
    return order


@router.patch("/{order_id}/ack", response_model=OrderOut)
async def acknowledge_order(
    order_id: int,
    body: OrderAckUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_crc),
):
    """CRC or BCC presses Reçu — step 1."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable")
    if order.status not in ("pending", "acknowledged"):
        raise HTTPException(status_code=409, detail=f"Ordre déjà en statut '{order.status}'")

    # Create or update the ack record for this user
    ack = db.query(OrderAck).filter(
        OrderAck.order_id == order_id,
        OrderAck.user_id == current_user.id,
    ).first()

    if not ack:
        ack = OrderAck(
            order_id=order_id,
            user_id=current_user.id,
            bcc_id=body.bcc_id or current_user.bcc_id,
            mw_assigned=body.mw_assigned,
        )
        db.add(ack)

    ack.acked_at = datetime.now(timezone.utc)
    ack.status = "acknowledged"
    order.status = "acknowledged"
    db.commit()
    db.refresh(order)

    # Broadcast ack event
    await manager.broadcast(
        {
            "event": "order_acked",
            "order_id": order_id,
            "order_ref": order.order_ref,
            "user_id": current_user.id,
            "bcc_id": ack.bcc_id,
            "acked_at": ack.acked_at.isoformat(),
        }
    )

    return order


@router.patch("/{order_id}/execute", response_model=OrderOut)
async def execute_order(
    order_id: int,
    body: OrderExecuteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """BCC confirms execution — step 2."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable")

    ack = db.query(OrderAck).filter(
        OrderAck.order_id == order_id,
        OrderAck.user_id == current_user.id,
    ).first()

    if not ack:
        raise HTTPException(status_code=404, detail="Aucun accusé de réception trouvé pour cet utilisateur")

    ack.executed_at = datetime.now(timezone.utc)
    ack.mw_executed = body.mw_executed
    ack.status = "completed"

    # Check if all acks are completed → mark order as completed
    all_acks = db.query(OrderAck).filter(OrderAck.order_id == order_id).all()
    if all_acks and all(a.status == "completed" for a in all_acks):
        order.status = "completed"
    else:
        order.status = "executing"

    db.commit()
    db.refresh(order)

    # Broadcast execution event
    await manager.broadcast(
        {
            "event": "order_executed",
            "order_id": order_id,
            "order_ref": order.order_ref,
            "bcc_id": current_user.bcc_id,
            "mw_executed": body.mw_executed,
            "executed_at": ack.executed_at.isoformat(),
            "order_status": order.status,
        }
    )

    return order


@router.patch("/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dn),
):
    """DN manually cancels an active order."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable")
    if order.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="Ordre déjà terminé ou annulé")

    order.status = "cancelled"
    order.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(order)

    await manager.broadcast(
        {
            "event": "order_cancelled",
            "order_id": order_id,
            "order_ref": order.order_ref,
            "cancelled_at": order.cancelled_at.isoformat(),
        }
    )

    return order
