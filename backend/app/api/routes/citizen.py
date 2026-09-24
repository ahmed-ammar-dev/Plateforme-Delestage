"""
Citizen portal API — ported from citizans/backend/main.py.

All endpoints are read-only from the citizen's perspective.
No operational data (orders, grid frequency, operator names) is exposed.

Base prefix: /api/citizen  (registered in main.py)
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.citizen import (
    Citizen,
    CitizenExecutionLog,
    CitizenProgramSchedule,
    CitizenZone,
)

router = APIRouter(prefix="/citizen", tags=["citizen-portal"])

TUNIS_TZ = ZoneInfo("Africa/Tunis")


# ── Time helpers ──────────────────────────────────────────────────────────────

def tunis_now() -> datetime:
    return datetime.now(TUNIS_TZ)


def today_tunis() -> date:
    return tunis_now().date()


def as_float(value: Any) -> Optional[float]:
    return None if value is None else float(value)


def time_to_str(t: Optional[time]) -> Optional[str]:
    return t.strftime("%H:%M") if t else None


def dt_to_iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def schedule_datetime(d: date, t: time) -> datetime:
    return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second, tzinfo=TUNIS_TZ)


# ── Schedule helpers ──────────────────────────────────────────────────────────

def schedule_is_active(s: CitizenProgramSchedule, now: Optional[datetime] = None) -> bool:
    if s.status == "cancelled":
        return False
    now = now or tunis_now()
    if s.scheduled_date != now.date():
        return False
    start = schedule_datetime(s.scheduled_date, s.start_time)
    end   = schedule_datetime(s.scheduled_date, s.end_time)
    return start <= now < end


def schedule_upcoming_or_active(s: CitizenProgramSchedule, now: Optional[datetime] = None) -> bool:
    if s.status == "cancelled":
        return False
    now = now or tunis_now()
    if s.scheduled_date != now.date():
        return False
    end = schedule_datetime(s.scheduled_date, s.end_time)
    return end > now


def schedule_to_item(s: CitizenProgramSchedule, now: Optional[datetime] = None) -> dict:
    now    = now or tunis_now()
    active = schedule_is_active(s, now)
    return {
        "id":               s.id,
        "start":            time_to_str(s.start_time),
        "end":              time_to_str(s.end_time),
        "start_time":       time_to_str(s.start_time),
        "end_time":         time_to_str(s.end_time),
        "duration":         f"{s.duration_minutes} min",
        "duration_minutes": s.duration_minutes,
        "status":           "Active now" if active else "Planned",
        "active":           active,
        "target_mw":        as_float(s.target_mw),
        "reason":           s.reason,
    }


def zone_today_schedules(db: Session, zone_id: int) -> list[CitizenProgramSchedule]:
    return (
        db.query(CitizenProgramSchedule)
        .filter(
            CitizenProgramSchedule.zone_id == zone_id,
            CitizenProgramSchedule.scheduled_date == today_tunis(),
            CitizenProgramSchedule.status != "cancelled",
        )
        .order_by(CitizenProgramSchedule.start_time.asc())
        .all()
    )


def zone_status_dict(zone: CitizenZone, active_schedule: Optional[CitizenProgramSchedule]) -> dict:
    """Return public-safe status labels — never exposes operational details."""
    if active_schedule:
        return {
            "status":       "outage",
            "status_label": "Coupure en cours",
            "description":  "Votre zone est actuellement en délestage planifié.",
        }
    raw = (zone.electricity_status or "").lower()
    if "outage" in raw or "scheduled" in raw or "emergency" in raw:
        return {
            "status":       "outage",
            "status_label": zone.electricity_status,
            "description":  "Une interruption est en cours dans votre zone.",
        }
    if "demand" in raw:
        return {
            "status":       "demand",
            "status_label": "Demande élevée",
            "description":  "L'électricité est disponible mais la demande est forte.",
        }
    return {
        "status":       "available",
        "status_label": "Alimentation normale",
        "description":  "L'électricité est disponible dans votre zone.",
    }


def zone_to_dict(db: Session, zone: CitizenZone, include_schedule: bool = True) -> dict:
    now       = tunis_now()
    schedules = zone_today_schedules(db, zone.id) if include_schedule else []
    active    = next((s for s in schedules if schedule_is_active(s, now)), None)
    situation = zone_status_dict(zone, active)
    return {
        "id":                  zone.id,
        "name":                zone.name,
        "governorate":         zone.governorate,
        "latitude":            zone.latitude,
        "longitude":           zone.longitude,
        "electricity_status":  "Coupure en cours" if active else zone.electricity_status,
        "currentStatus":       situation["status"],
        "currentStatusLabel":  situation["status_label"],
        "currentDescription":  situation["description"],
        "shedding": [
            schedule_to_item(s, now)
            for s in schedules
            if schedule_upcoming_or_active(s, now)
        ],
    }


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    return {
        "status": "ok",
        "date":   today_tunis().isoformat(),
        "time":   tunis_now().isoformat(),
    }


# ── Zones ─────────────────────────────────────────────────────────────────────

@router.get("/zones")
def get_zones(db: Session = Depends(get_db)):
    """All zones with today's public schedule — used by the map."""
    zones = (
        db.query(CitizenZone)
        .order_by(CitizenZone.governorate.asc(), CitizenZone.name.asc())
        .all()
    )
    return [zone_to_dict(db, z) for z in zones]


@router.get("/zones/{zone_id}")
def get_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.get(CitizenZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone introuvable")
    return zone_to_dict(db, zone)


# ── Citizens ──────────────────────────────────────────────────────────────────

@router.get("/citizens/{citizen_id}")
def get_citizen(citizen_id: int, db: Session = Depends(get_db)):
    citizen = db.get(Citizen, citizen_id)
    if not citizen:
        raise HTTPException(status_code=404, detail="Citoyen introuvable")
    if not citizen.is_active:
        raise HTTPException(status_code=403, detail="Compte inactif")
    zone = db.get(CitizenZone, citizen.zone_id)
    if not zone:
        raise HTTPException(status_code=409, detail="Zone du citoyen introuvable")
    return {
        "id":          citizen.id,
        "first_name":  citizen.first_name,
        "last_name":   citizen.last_name,
        "name":        f"{citizen.first_name} {citizen.last_name}".strip(),
        "email":       citizen.email,
        "phone":       citizen.phone,
        "zone_id":     citizen.zone_id,
        "governorate": citizen.governorate or zone.governorate,
        "address":     citizen.address,
        "is_active":   citizen.is_active,
    }


# ── Citizen dashboard ─────────────────────────────────────────────────────────

@router.get("/dashboard/{citizen_id}")
def citizen_dashboard(citizen_id: int, db: Session = Depends(get_db)):
    """
    Main endpoint consumed by the citizen portal App.jsx.
    Previously at GET /api/citizen/dashboard/{citizen_id}.
    """
    citizen = db.get(Citizen, citizen_id)
    if not citizen:
        raise HTTPException(status_code=404, detail="Citoyen introuvable")
    if not citizen.is_active:
        raise HTTPException(status_code=403, detail="Compte inactif")

    zone = db.get(CitizenZone, citizen.zone_id)
    if not zone:
        raise HTTPException(status_code=409, detail="Zone introuvable")

    now            = tunis_now()
    schedules      = zone_today_schedules(db, zone.id)
    active_sched   = next((s for s in schedules if schedule_is_active(s, now)), None)
    situation      = zone_status_dict(zone, active_sched)
    today_schedule = [
        schedule_to_item(s, now)
        for s in schedules
        if schedule_upcoming_or_active(s, now)
    ]

    return {
        "date": today_tunis().isoformat(),
        "citizen": {
            "id":          citizen.id,
            "first_name":  citizen.first_name,
            "last_name":   citizen.last_name,
            "name":        f"{citizen.first_name} {citizen.last_name}".strip(),
            "email":       citizen.email,
            "phone":       citizen.phone,
            "zone_id":     citizen.zone_id,
            "governorate": citizen.governorate or zone.governorate,
            "address":     citizen.address,
        },
        "zone": {
            "id":                 zone.id,
            "name":               zone.name,
            "governorate":        zone.governorate,
            "latitude":           zone.latitude,
            "longitude":          zone.longitude,
            "electricity_status": "Coupure en cours" if active_sched else zone.electricity_status,
        },
        "current_situation": {
            **situation,
            "under_shedding":  active_sched is not None,
            "active_shedding": schedule_to_item(active_sched, now) if active_sched else None,
        },
        "today_schedule":      today_schedule,
        "total_interruptions": len(today_schedule),
    }


# ── Virtual check ─────────────────────────────────────────────────────────────

@router.get("/virtual-check")
def virtual_check(zone_id: int = Query(..., ge=1), db: Session = Depends(get_db)):
    """Check electricity status for any zone (not just the citizen's own zone)."""
    zone = db.get(CitizenZone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone introuvable")

    now          = tunis_now()
    schedules    = zone_today_schedules(db, zone.id)
    active_sched = next((s for s in schedules if schedule_is_active(s, now)), None)
    situation    = zone_status_dict(zone, active_sched)
    today_items  = [
        schedule_to_item(s, now)
        for s in schedules
        if schedule_upcoming_or_active(s, now)
    ]

    return {
        "date": today_tunis().isoformat(),
        "zone": {
            "id":                  zone.id,
            "name":                zone.name,
            "governorate":         zone.governorate,
            "latitude":            zone.latitude,
            "longitude":           zone.longitude,
            "electricity_status":  "Coupure en cours" if active_sched else zone.electricity_status,
            "currentStatus":       situation["status"],
            "currentStatusLabel":  situation["status_label"],
            "currentDescription":  situation["description"],
        },
        "current_situation": {
            **situation,
            "under_shedding":  active_sched is not None,
            "active_shedding": schedule_to_item(active_sched, now) if active_sched else None,
        },
        "upcoming_shedding_today": today_items,
        "total_interruptions":     len(today_items),
    }


# ── Schedules ─────────────────────────────────────────────────────────────────

@router.get("/schedules")
def list_schedules(
    target_date: Optional[date] = None,
    zone_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CitizenProgramSchedule)
    if target_date:
        q = q.filter(CitizenProgramSchedule.scheduled_date == target_date)
    if zone_id:
        q = q.filter(CitizenProgramSchedule.zone_id == zone_id)
    rows = q.order_by(
        CitizenProgramSchedule.scheduled_date.asc(),
        CitizenProgramSchedule.start_time.asc(),
    ).all()
    return [schedule_to_item(s) for s in rows]


# ── AI status placeholder ─────────────────────────────────────────────────────

@router.get("/ai/status")
def ai_status():
    """
    Placeholder for the future LLM chatbot.
    When wired, the LLM will only have access to citizen_zones,
    citizen_program_schedule and citizen_execution_log — never to
    operational tables (orders, executions, grid telemetry).
    """
    return {
        "enabled":  False,
        "provider": None,
        "model":    None,
        "message":  (
            "L'assistant citoyen sera connecté ultérieurement. "
            "Il n'aura accès qu'aux informations publiques de délestage."
        ),
    }
