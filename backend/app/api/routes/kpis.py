"""
KPI aggregation endpoints.
Read-only — all data computed from executions table.
"""
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_bcc, require_crc
from app.core.database import get_db
from app.models.execution import Execution
from app.models.network import BCC, CRC, Feeder
from app.models.order import Order
from app.models.user import User

router = APIRouter(prefix="/kpis", tags=["kpis"])
TUNIS_TZ = ZoneInfo("Africa/Tunis")


@router.get("/national")
def national_kpis(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """DN-level KPIs: total ENS, active cuts, active orders."""
    total_ens = db.query(func.sum(Execution.ens_mwh)).filter(
        Execution.status == "restored"
    ).scalar() or 0.0

    active_cuts = db.query(func.count(Execution.id)).filter(
        Execution.status == "executing"
    ).scalar() or 0

    active_mw = db.query(func.sum(Execution.mw_shed)).filter(
        Execution.status == "executing"
    ).scalar() or 0.0

    active_orders = db.query(func.count(Order.id)).filter(
        Order.status.in_(["pending", "acknowledged", "executing"])
    ).scalar() or 0

    bccs_in_anomaly = db.query(func.count(BCC.id)).scalar() or 0

    return {
        "total_ens_mwh": round(total_ens, 2),
        "active_cuts_count": active_cuts,
        "active_shedding_mw": round(active_mw, 2),
        "active_orders_count": active_orders,
        "bccs_total": bccs_in_anomaly,
    }


@router.get("/crc/{crc_id}")
def crc_kpis(
    crc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_crc),
):
    """CRC-level KPIs: aggregated from BCCs under this CRC."""
    crc = db.get(CRC, crc_id)
    if not crc:
        return {"error": "CRC introuvable"}

    bcc_ids = [b.id for b in db.query(BCC.id).filter(BCC.crc_id == crc_id).all()]

    active_mw = db.query(func.sum(Execution.mw_shed)).filter(
        Execution.bcc_id.in_(bcc_ids),
        Execution.status == "executing",
    ).scalar() or 0.0

    ens_today = db.query(func.sum(Execution.ens_mwh)).filter(
        Execution.bcc_id.in_(bcc_ids),
        Execution.status == "restored",
    ).scalar() or 0.0

    active_cuts = db.query(func.count(Execution.id)).filter(
        Execution.bcc_id.in_(bcc_ids),
        Execution.status == "executing",
    ).scalar() or 0

    return {
        "crc_id": crc_id,
        "crc_name": crc.name,
        "active_shedding_mw": round(active_mw, 2),
        "ens_mwh": round(ens_today, 2),
        "active_cuts_count": active_cuts,
        "bcc_count": len(bcc_ids),
    }


@router.get("/bcc/{bcc_id}")
def bcc_kpis(
    bcc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    """BCC-level KPIs: feeder stats, ENS, equity."""
    # BCC operators only see their own data
    if current_user.role == "BCC" and current_user.bcc_id != bcc_id:
        return {"error": "Accès refusé"}

    active_mw = db.query(func.sum(Execution.mw_shed)).filter(
        Execution.bcc_id == bcc_id,
        Execution.status == "executing",
    ).scalar() or 0.0

    ens_total = db.query(func.sum(Execution.ens_mwh)).filter(
        Execution.bcc_id == bcc_id,
        Execution.status == "restored",
    ).scalar() or 0.0

    total_cuts = db.query(func.count(Execution.id)).filter(
        Execution.bcc_id == bcc_id,
    ).scalar() or 0

    # Per-feeder cumulative cut hours (for equity chart)
    feeder_stats = (
        db.query(
            Execution.feeder_id,
            Feeder.ref,
            Feeder.nom,
            Feeder.priority,
            func.sum(Execution.duration_min).label("total_min"),
            func.sum(Execution.ens_mwh).label("total_ens"),
            func.count(Execution.id).label("cut_count"),
        )
        .join(Feeder, Feeder.id == Execution.feeder_id)
        .filter(Execution.bcc_id == bcc_id, Execution.status == "restored")
        .group_by(Execution.feeder_id, Feeder.ref, Feeder.nom, Feeder.priority)
        .all()
    )

    return {
        "bcc_id": bcc_id,
        "active_shedding_mw": round(active_mw, 2),
        "ens_total_mwh": round(ens_total, 2),
        "total_cuts": total_cuts,
        "feeder_stats": [
            {
                "feeder_id": row.feeder_id,
                "ref": row.ref,
                "nom": row.nom,
                "priority": row.priority,
                "total_hours": round((row.total_min or 0) / 60, 2),
                "total_ens_mwh": round(row.total_ens or 0, 2),
                "cut_count": row.cut_count,
            }
            for row in feeder_stats
        ],
    }


# ── Timeseries endpoint ───────────────────────────────────────────────────────

@router.get("/timeseries")
def get_timeseries(
    target_date: date = Query(default=None, description="Date ISO (default: today in Tunis TZ)"),
    interval_min: int = Query(default=30, ge=15, le=60, description="Slot width in minutes"),
    crc_id: int | None = Query(default=None, description="Filter to one CRC (optional)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return MW shed per time slot for a given day.

    Response shape:
    {
      "date": "2026-09-25",
      "interval_min": 30,
      "slots": [
        {
          "slot":     "00:00",          // slot start HH:MM
          "slot_end": "00:30",          // slot end HH:MM
          "mw_plan":  45.0,             // J-1 consigne for this slot
          "mw_real":  42.3,             // actual MW shed during this slot
          "is_past":  true,             // slot is in the past
          "is_now":   false             // current slot
        },
        ...
      ],
      "total_ens_mwh": 128.4
    }
    """
    if target_date is None:
        target_date = datetime.now(TUNIS_TZ).date()

    # Build slot boundaries in UTC
    day_start_local = datetime(target_date.year, target_date.month, target_date.day,
                                0, 0, 0, tzinfo=TUNIS_TZ)
    day_end_local   = day_start_local + timedelta(days=1)
    day_start_utc   = day_start_local.astimezone(timezone.utc)
    day_end_utc     = day_end_local.astimezone(timezone.utc)
    now_utc         = datetime.now(timezone.utc)

    # Restrict to BCCs of a given CRC if requested
    bcc_filter_ids: list[int] | None = None
    if crc_id is not None:
        bcc_filter_ids = [
            b.id for b in db.query(BCC.id).filter(BCC.crc_id == crc_id).all()
        ]

    # Static per-slot consignes (realistic Tunisian daily profile)
    # Index 0 = 00:00, index 1 = 00:30, …, index 47 = 23:30 (for 30-min slots)
    # Values represent the national planned shedding MW for each slot
    _SLOTS_PER_DAY = 24 * 60 // interval_min
    # Simplified J-1 plan: low at night, peaks at 14:00 and 20:00
    def _plan_mw(slot_idx: int) -> float:
        hour = (slot_idx * interval_min) / 60
        if   hour < 6:   return 80.0
        elif hour < 8:   return 120.0
        elif hour < 10:  return 200.0
        elif hour < 13:  return 350.0
        elif hour < 14:  return 420.0
        elif hour < 16:  return 450.0
        elif hour < 18:  return 380.0
        elif hour < 20:  return 310.0
        elif hour < 22:  return 420.0
        elif hour < 23:  return 280.0
        else:            return 150.0

    # Scale plan down to CRC share if filtered
    crc_scale = 1.0
    if crc_id is not None:
        crc = db.get(CRC, crc_id)
        if crc:
            crc_scale = 0.67 if "Nord" in (crc.name or "") else 0.33

    # Query: sum of mw_shed for all executions that were ACTIVE during each slot
    # An execution is active in a slot if started_at < slot_end AND
    # (ended_at IS NULL OR ended_at > slot_start)
    slots_data = []
    total_ens  = 0.0

    for slot_idx in range(_SLOTS_PER_DAY):
        slot_start_utc = day_start_utc + timedelta(minutes=slot_idx * interval_min)
        slot_end_utc   = slot_start_utc + timedelta(minutes=interval_min)

        if slot_start_utc >= day_end_utc:
            break

        q = db.query(func.coalesce(func.sum(Execution.mw_shed), 0.0)).filter(
            Execution.started_at < slot_end_utc,
            (Execution.ended_at == None) | (Execution.ended_at > slot_start_utc),  # noqa: E711
            Execution.started_at >= day_start_utc,
        )
        if bcc_filter_ids is not None:
            q = q.filter(Execution.bcc_id.in_(bcc_filter_ids))

        mw_real = float(q.scalar() or 0.0)
        plan    = round(_plan_mw(slot_idx) * crc_scale, 1)

        is_past = slot_end_utc   <= now_utc
        is_now  = slot_start_utc <= now_utc < slot_end_utc

        # ENS contribution for past slots
        if is_past or is_now:
            total_ens += mw_real * (interval_min / 60)

        # Format slot labels in Tunis local time
        slot_local     = slot_start_utc.astimezone(TUNIS_TZ)
        slot_end_local = slot_end_utc.astimezone(TUNIS_TZ)
        slot_label     = slot_local.strftime("%H:%M")
        slot_end_label = slot_end_local.strftime("%H:%M")

        slots_data.append({
            "slot":      slot_label,
            "slot_end":  slot_end_label,
            "slot_idx":  slot_idx,
            "mw_plan":   plan,
            "mw_real":   round(mw_real, 1) if (is_past or is_now) else None,
            "is_past":   is_past,
            "is_now":    is_now,
        })

    return {
        "date":          target_date.isoformat(),
        "interval_min":  interval_min,
        "crc_id":        crc_id,
        "slots":         slots_data,
        "total_ens_mwh": round(total_ens, 2),
    }
