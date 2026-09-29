from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_bcc, require_dn
from app.core.database import get_db
from app.models.network import BCC, CRC
from app.models.programme import Programme, ProgrammeSlot
from app.models.user import User
from app.schemas.programme import ProgrammeCreate, ProgrammeOut, SlotUpdate
from app.api.routes.settings import _load as _load_settings
from app.services.websocket import manager

router = APIRouter(prefix="/programmes", tags=["programmes"])

# ── Realistic 48-slot national load-shedding profile (peak ≈ 500 MW)
# Each value is the *national* MW to shed at that 30-min slot.
# Scaled to match typical Tunisian délestage levels (100–500 MW range).
# CRC allocation = national_mw × split_pct / 100  (split read from settings).
_NATIONAL_PROFILE_MW = [
    # 00:00–03:30  overnight low
     72,  66,  60,  58,  56,  55,  58,  63,
    # 04:00–07:30  early ramp
     70,  80,  92, 108, 125, 142, 158, 175,
    # 08:00–11:30  morning ramp
    200, 233, 267, 300, 333, 358, 384, 400,
    # 12:00–15:30  peak
    425, 450, 475, 492, 500, 492, 475, 450,
    # 16:00–19:30  afternoon plateau
    430, 408, 384, 358, 333, 309, 292, 275,
    # 20:00–23:30  evening decline
    264, 243, 217, 191, 167, 147, 125, 103,
]


def _generate_slots(crc_name: str) -> list[dict[str, Any]]:
    """
    Generate 48 half-hour slots (00:00→23:30) with MW targets for a CRC.
    Uses the live split key from settings so the fallback profile is consistent
    with what the DN would have set in Paramètres & Seuils.
    """
    cfg        = _load_settings()
    split_nord = int(cfg.get("split_nord", 67))
    split_sud  = 100 - split_nord
    is_nord    = "Nord" in crc_name
    split_pct  = split_nord if is_nord else split_sud

    slots = []
    for i, national_mw in enumerate(_NATIONAL_PROFILE_MW):
        h = (i * 30) // 60
        m = (i * 30) % 60
        mw_crc = round(national_mw * split_pct / 100, 1)
        slots.append({
            "time_slot": f"{h:02d}:{m:02d}",
            "mw_crc":    mw_crc,
            "source":    "mock_profile",
        })
    return slots


@router.get("", response_model=list[ProgrammeOut])
def list_programmes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Programme).order_by(Programme.programme_date.desc()).limit(30).all()


# ── CRC-facing endpoints — MUST be declared before /{prog_date} ───────────────
# FastAPI matches routes in declaration order; if /{prog_date} comes first it
# will try to parse "crc-slots" as a date and return a 422 instead of routing
# to the correct handler.

@router.get("/crc-slots")
def get_crc_slots(
    crc_name: str = Query("CRC Nord", description="CRC name: 'CRC Nord' or 'CRC Sud'"),
    target_date: date | None = Query(None, description="ISO date, defaults to tomorrow"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Returns the 48 half-hour MW targets the DN has assigned to this CRC for
    tomorrow (or target_date).  If a formal Programme exists for that date it
    is used; otherwise a realistic daily profile is returned so the CRC can
    work ahead of DN confirmation.
    """
    use_date = target_date or (date.today() + timedelta(days=1))

    prog = (
        db.query(Programme)
        .filter(Programme.programme_date == use_date)
        .first()
    )

    if prog and prog.slots:
        # Pull the CRC-level MW from the DB slots (mw_nord / mw_sud)
        is_nord  = "Nord" in crc_name
        mw_field = "mw_nord" if is_nord else "mw_sud"

        # Deduplicate: keep one row per time_slot, national-level only (bcc_id IS NULL)
        seen: set[str] = set()
        slots_out = []
        for s in sorted(prog.slots, key=lambda x: x.time_slot):
            if s.bcc_id is not None:
                continue          # skip BCC-level rows, we only want national targets
            if s.time_slot in seen:
                continue
            seen.add(s.time_slot)
            slots_out.append({
                "time_slot": s.time_slot,
                "mw_crc":    getattr(s, mw_field),
                "source":    "programme",
            })
        return {
            "programme_id":   prog.id,
            "programme_date": use_date.isoformat(),
            "crc_name":       crc_name,
            "status":         prog.status,
            "slots":          slots_out,
        }

    # No formal programme yet — return the mock profile scaled by the split key
    return {
        "programme_id":   None,
        "programme_date": use_date.isoformat(),
        "crc_name":       crc_name,
        "status":         "no_programme",
        "slots":          _generate_slots(crc_name),
    }


@router.post("/crc-submit")
async def submit_crc_distribution(
    body: dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    CRC submits their BCC distribution for J+1.
    Body: { crc_name, programme_date, slots: [{time_slot, bcc_id, mw_bcc}, ...] }

    On success:
    - Upserts ProgrammeSlot rows with bcc_id + mw_bcc (status = 'assigned').
    - Broadcasts a 'j1_assigned' WebSocket event to every BCC that received
      at least one slot so they can show a notification and reload their planner.
    """
    crc_name      = body.get("crc_name", "CRC Nord")
    prog_date_str = body.get("programme_date")
    raw_slots     = body.get("slots", [])

    if not prog_date_str:
        raise HTTPException(status_code=422, detail="programme_date is required")

    try:
        prog_date = date.fromisoformat(prog_date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid programme_date format")

    crc = db.query(CRC).filter(CRC.name == crc_name).first()
    if not crc:
        raise HTTPException(status_code=404, detail=f"CRC '{crc_name}' introuvable")

    prog = db.query(Programme).filter(Programme.programme_date == prog_date).first()
    if not prog:
        prog = Programme(programme_date=prog_date, created_by=current_user.id, status="draft")
        db.add(prog)
        db.flush()

    saved = 0
    # Track per-BCC summary for the WS broadcast
    bcc_summary: dict[int, dict] = {}   # bcc_id → {slots_count, total_mw}

    for slot_data in raw_slots:
        time_slot = slot_data.get("time_slot")
        bcc_id    = slot_data.get("bcc_id")
        mw_bcc    = float(slot_data.get("mw_bcc", 0))

        if not time_slot or bcc_id is None:
            continue

        existing = (
            db.query(ProgrammeSlot)
            .filter(
                ProgrammeSlot.programme_id == prog.id,
                ProgrammeSlot.time_slot    == time_slot,
                ProgrammeSlot.bcc_id       == bcc_id,
            )
            .first()
        )
        if existing:
            existing.mw_bcc = mw_bcc
            existing.status = "assigned"
        else:
            db.add(ProgrammeSlot(
                programme_id = prog.id,
                time_slot    = time_slot,
                mw_national  = 0.0,
                mw_nord      = slot_data.get("mw_crc", 0.0) if "Nord" in crc_name else 0.0,
                mw_sud       = slot_data.get("mw_crc", 0.0) if "Sud"  in crc_name else 0.0,
                bcc_id       = bcc_id,
                mw_bcc       = mw_bcc,
                status       = "assigned",
            ))
        saved += 1

        # Accumulate per-BCC stats for the notification payload
        entry = bcc_summary.setdefault(bcc_id, {"slots_count": 0, "total_mw": 0.0})
        entry["slots_count"] += 1
        entry["total_mw"]    = round(entry["total_mw"] + mw_bcc, 1)

    db.commit()

    # ── Broadcast j1_assigned to each targeted BCC ────────────────────────────
    # Resolve BCC names once so the notification payload is human-readable.
    bcc_rows = db.query(BCC).filter(BCC.id.in_(list(bcc_summary.keys()))).all()
    bcc_name_map = {b.id: b.name for b in bcc_rows}

    for bcc_id_key, stats in bcc_summary.items():
        ws_event = {
            "event":          "j1_assigned",
            "programme_id":   prog.id,
            "programme_date": prog_date.isoformat(),
            "crc_name":       crc_name,
            "bcc_id":         bcc_id_key,
            "bcc_name":       bcc_name_map.get(bcc_id_key, f"BCC {bcc_id_key}"),
            "slots_count":    stats["slots_count"],
            "total_mw":       stats["total_mw"],
        }
        await manager.broadcast_to_bcc(ws_event, bcc_id_key)

    return {
        "programme_id":   prog.id,
        "programme_date": prog_date.isoformat(),
        "crc_name":       crc_name,
        "slots_saved":    saved,
        "bccs_notified":  list(bcc_summary.keys()),
        "status":         "ok",
    }


# ── BCC-facing endpoint: read assigned slots ──────────────────────────────────

# BCC ratio within CRC — used for fallback profile when CRC hasn't submitted yet.
# Keys match BCC.name in the DB.  Values sum to 1.0 within each CRC.
_BCC_RATIOS: dict[str, float] = {
    "BCC 1": 0.367,  # CRC Nord
    "BCC 2": 0.300,  # CRC Nord
    "BCC 3": 0.193,  # CRC Nord
    "BCC 4": 0.140,  # CRC Nord
    "BCC 5": 0.350,  # CRC Sud (example ratios)
    "BCC 6": 0.400,  # CRC Sud
    "BCC 7": 0.250,  # CRC Sud
}


def _generate_bcc_slots(bcc_name: str, crc_name: str) -> list[dict[str, Any]]:
    """
    Fallback: generate 48 half-hour slots for a BCC when no CRC distribution
    has been saved yet.  Uses the national profile × CRC split × BCC ratio.
    """
    cfg        = _load_settings()
    split_nord = int(cfg.get("split_nord", 67))
    split_sud  = 100 - split_nord
    is_nord    = "Nord" in crc_name
    crc_pct    = split_nord if is_nord else split_sud
    bcc_ratio  = _BCC_RATIOS.get(bcc_name, 0.20)

    slots = []
    for i, national_mw in enumerate(_NATIONAL_PROFILE_MW):
        h = (i * 30) // 60
        m = (i * 30) % 60
        mw_bcc = round(national_mw * crc_pct / 100 * bcc_ratio, 1)
        slots.append({
            "time_slot": f"{h:02d}:{m:02d}",
            "mw_bcc":    mw_bcc,
            "source":    "mock_profile",
        })
    return slots


@router.get("/bcc-slots")
def get_bcc_slots(
    bcc_id: int = Query(..., description="BCC database id"),
    target_date: date | None = Query(None, description="ISO date, defaults to tomorrow"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Returns the 48 half-hour MW targets the CRC has assigned to this BCC for
    tomorrow (or target_date).

    Also returns the list of this BCC's feeders (ref, nom, mw_nominal, priority,
    days_since_last_cut) so the frontend can populate the feeder picker without
    a second round-trip.

    If the CRC has not yet submitted a distribution, a realistic fallback profile
    is returned so the BCC can start planning ahead of CRC confirmation.
    """
    from app.models.execution import Execution
    from app.models.network import Feeder

    use_date = target_date or (date.today() + timedelta(days=1))

    bcc = db.get(BCC, bcc_id)
    if not bcc:
        raise HTTPException(status_code=404, detail=f"BCC id={bcc_id} introuvable")

    crc_name = bcc.crc.name if bcc.crc else "CRC Nord"

    # ── Slot data from DB ────────────────────────────────────────────────────
    prog = (
        db.query(Programme)
        .filter(Programme.programme_date == use_date)
        .first()
    )

    status_out = "no_programme"
    programme_id = None

    if prog and prog.slots:
        # Look for BCC-level slots (bcc_id matches)
        bcc_slots_db = [s for s in prog.slots if s.bcc_id == bcc_id]

        if bcc_slots_db:
            # CRC has assigned this BCC — use DB values
            seen: set[str] = set()
            slots_out = []
            for s in sorted(bcc_slots_db, key=lambda x: x.time_slot):
                if s.time_slot in seen:
                    continue
                seen.add(s.time_slot)
                slots_out.append({
                    "time_slot": s.time_slot,
                    "mw_bcc":    s.mw_bcc,
                    "source":    "programme",
                    "slot_status": s.status,
                })
            programme_id = prog.id
            status_out   = prog.status
        else:
            # Programme exists but CRC hasn't split to this BCC yet — estimate
            is_nord   = "Nord" in crc_name
            mw_field  = "mw_nord" if is_nord else "mw_sud"
            bcc_ratio = _BCC_RATIOS.get(bcc.name, 0.20)

            seen2: set[str] = set()
            slots_out = []
            for s in sorted(prog.slots, key=lambda x: x.time_slot):
                if s.time_slot in seen2 or s.bcc_id is not None:
                    continue
                seen2.add(s.time_slot)
                slots_out.append({
                    "time_slot": s.time_slot,
                    "mw_bcc":    round(getattr(s, mw_field) * bcc_ratio, 1),
                    "source":    "estimated",
                    "slot_status": "pending",
                })
            programme_id = prog.id
            status_out   = "crc_pending"
    else:
        # No programme at all — full fallback
        slots_out = _generate_bcc_slots(bcc.name, crc_name)
        status_out = "no_programme"

    # Pad to 48 slots if source gave fewer
    if len(slots_out) < 48:
        fallback = _generate_bcc_slots(bcc.name, crc_name)
        existing_ts = {s["time_slot"] for s in slots_out}
        for fb in fallback:
            if fb["time_slot"] not in existing_ts:
                slots_out.append(fb)
        slots_out.sort(key=lambda x: x["time_slot"])

    # ── Feeder catalogue with days_since_last_cut ────────────────────────────
    feeders_db = (
        db.query(Feeder)
        .filter(Feeder.bcc_id == bcc_id)
        .order_by(Feeder.priority, Feeder.ref)
        .all()
    )

    # One query for last execution per feeder in this BCC
    last_cuts: dict[int, datetime] = {}
    exec_rows = (
        db.query(Execution.feeder_id, Execution.started_at)
        .filter(
            Execution.bcc_id == bcc_id,
            Execution.status.in_(["executing", "restored"]),
        )
        .order_by(Execution.started_at.desc())
        .all()
    )
    for feeder_id, started_at in exec_rows:
        if feeder_id not in last_cuts:
            last_cuts[feeder_id] = started_at

    now_utc = datetime.now(timezone.utc)

    feeders_out = []
    for f in feeders_db:
        last = last_cuts.get(f.id)
        if last:
            delta = now_utc - (last if last.tzinfo else last.replace(tzinfo=timezone.utc))
            days_since: float | None = round(delta.total_seconds() / 86400, 1)
        else:
            days_since = None

        feeders_out.append({
            "id":           f.id,
            "ref":          f.ref,
            "nom":          f.nom,
            "poste_source": f.poste_source,
            "mw":           f.mw_nominal,
            "priority":     f.priority,
            "locked":       f.priority == "P0",
            "days_since":   days_since,
        })

    return {
        "programme_id":   programme_id,
        "programme_date": use_date.isoformat(),
        "bcc_id":         bcc_id,
        "bcc_name":       bcc.name,
        "crc_name":       crc_name,
        "status":         status_out,
        "slots":          slots_out,
        "feeders":        feeders_out,
    }


# ── BCC: submit feeder assignments for J+1 ────────────────────────────────────

@router.post("/bcc-validate")
async def bcc_validate_programme(
    body: dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    BCC submits their feeder assignments for each J+1 slot.

    Body: {
        bcc_id: int,
        programme_date: str (ISO),
        slots: [
            {
                time_slot: str,           e.g. "14:00"
                feeder_refs: [str],       e.g. ["F07","F08","F11"]
                mw_planned: float         sum of selected feeder MW
            },
            ...
        ]
    }

    Marks corresponding ProgrammeSlot rows as 'validated'.
    Broadcasts a 'bcc_j1_validated' WebSocket event to CRC operators.
    """
    from app.models.network import Feeder

    bcc_id_in     = body.get("bcc_id")
    prog_date_str = body.get("programme_date")
    raw_slots     = body.get("slots", [])

    if not prog_date_str or bcc_id_in is None:
        raise HTTPException(status_code=422, detail="bcc_id and programme_date are required")

    try:
        prog_date = date.fromisoformat(prog_date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid programme_date format")

    bcc = db.get(BCC, bcc_id_in)
    if not bcc:
        raise HTTPException(status_code=404, detail=f"BCC id={bcc_id_in} introuvable")

    prog = db.query(Programme).filter(Programme.programme_date == prog_date).first()
    if not prog:
        # BCC can validate even if the formal programme hasn't been created yet
        prog = Programme(programme_date=prog_date, created_by=current_user.id, status="draft")
        db.add(prog)
        db.flush()

    saved = 0
    for slot_data in raw_slots:
        time_slot    = slot_data.get("time_slot")
        feeder_refs  = slot_data.get("feeder_refs", [])
        mw_planned   = float(slot_data.get("mw_planned", 0))

        if not time_slot:
            continue

        # Find or create the BCC-level slot row
        existing = (
            db.query(ProgrammeSlot)
            .filter(
                ProgrammeSlot.programme_id == prog.id,
                ProgrammeSlot.time_slot    == time_slot,
                ProgrammeSlot.bcc_id       == bcc_id_in,
            )
            .first()
        )

        notes_str = ",".join(feeder_refs)  # Store feeder refs in a notes field

        if existing:
            existing.mw_bcc  = mw_planned
            existing.status  = "validated"
            # Store feeder assignment in notes until a dedicated join table exists
            existing.notes   = notes_str if hasattr(existing, "notes") else None
        else:
            new_slot = ProgrammeSlot(
                programme_id = prog.id,
                time_slot    = time_slot,
                mw_national  = 0.0,
                mw_nord      = 0.0,
                mw_sud       = 0.0,
                bcc_id       = bcc_id_in,
                mw_bcc       = mw_planned,
                status       = "validated",
            )
            db.add(new_slot)
        saved += 1

    db.commit()

    # Broadcast to CRC operators so they see the BCC has validated
    ws_event = {
        "event":          "bcc_j1_validated",
        "bcc_id":         bcc_id_in,
        "bcc_name":       bcc.name,
        "programme_date": prog_date.isoformat(),
        "slots_saved":    saved,
        "validated_by":   current_user.username if hasattr(current_user, "username") else str(current_user.id),
    }
    await manager.broadcast_to_role(ws_event, "CRC")

    return {
        "programme_id":   prog.id,
        "programme_date": prog_date.isoformat(),
        "bcc_id":         bcc_id_in,
        "bcc_name":       bcc.name,
        "slots_saved":    saved,
        "status":         "ok",
    }


# ── DN: check J+1 status ─────────────────────────────────────────────────────

@router.get("/j1-status")
def get_j1_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Returns whether the J+1 programme for tomorrow has been created by the DN.
    Used by the frontend reminder hook and status banners.
    """
    tomorrow = date.today() + timedelta(days=1)
    prog = (
        db.query(Programme)
        .filter(Programme.programme_date == tomorrow)
        .first()
    )
    if prog:
        return {
            "has_programme":   True,
            "programme_id":    prog.id,
            "programme_date":  prog.programme_date.isoformat(),
            "status":          prog.status,
            "slot_count":      len(prog.slots),
        }
    return {
        "has_programme":   False,
        "programme_id":    None,
        "programme_date":  tomorrow.isoformat(),
        "status":          "no_programme",
        "slot_count":      0,
    }


# ── DN: create / overwrite J+1 national programme ─────────────────────────────

@router.post("/dn-submit")
async def dn_submit_programme(
    body: dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dn),
) -> dict[str, Any]:
    """
    DN submits the J+1 national programme.
    Body: {
        programme_date: str (ISO),
        slots: [{ time_slot, mw_national, mw_nord, mw_sud }, ...]
    }
    On success:
    - Upserts Programme + ProgrammeSlot rows (one national row per time_slot).
    - Sets status = 'validated'.
    - Broadcasts a 'j1_published' WebSocket event to all CRC clients.
    """
    prog_date_str = body.get("programme_date")
    raw_slots     = body.get("slots", [])
    is_zero       = body.get("auto_zero", False)   # True when triggered by auto-zero

    if not prog_date_str:
        raise HTTPException(status_code=422, detail="programme_date is required")

    try:
        prog_date = date.fromisoformat(prog_date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid programme_date format")

    # Upsert programme
    prog = db.query(Programme).filter(Programme.programme_date == prog_date).first()
    if prog:
        # Wipe existing national slots (bcc_id IS NULL) so we can rewrite them
        for s in list(prog.slots):
            if s.bcc_id is None:
                db.delete(s)
        db.flush()
        prog.status = "validated"
    else:
        prog = Programme(
            programme_date = prog_date,
            created_by     = current_user.id,
            status         = "validated",
        )
        db.add(prog)
        db.flush()

    for slot_data in raw_slots:
        time_slot  = slot_data.get("time_slot")
        mw_nat     = float(slot_data.get("mw_national", 0.0))
        mw_nord    = float(slot_data.get("mw_nord",     0.0))
        mw_sud     = float(slot_data.get("mw_sud",      0.0))
        if not time_slot:
            continue
        db.add(ProgrammeSlot(
            programme_id = prog.id,
            time_slot    = time_slot,
            mw_national  = mw_nat,
            mw_nord      = mw_nord,
            mw_sud       = mw_sud,
            bcc_id       = None,
            mw_bcc       = 0.0,
            status       = "pending",
        ))

    db.commit()

    # ── Build a compact summary to broadcast (first 48 slots) ─────────────────
    slots_summary = [
        {
            "time_slot":  s.get("time_slot"),
            "mw_national": s.get("mw_national", 0.0),
            "mw_nord":    s.get("mw_nord",    0.0),
            "mw_sud":     s.get("mw_sud",     0.0),
        }
        for s in raw_slots
    ]

    ws_event = {
        "event":          "j1_published",
        "programme_id":   prog.id,
        "programme_date": prog_date.isoformat(),
        "status":         prog.status,
        "is_auto_zero":   is_zero,
        "slots":          slots_summary,
    }
    await manager.broadcast_to_role(ws_event, "CRC")

    return {
        "programme_id":   prog.id,
        "programme_date": prog_date.isoformat(),
        "status":         prog.status,
        "slots_saved":    len(raw_slots),
        "is_auto_zero":   is_zero,
    }


# ── Parameterized route — MUST come after all literal-path GET routes ─────────

@router.get("/{prog_date}", response_model=ProgrammeOut)
def get_programme(
    prog_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prog = db.query(Programme).filter(Programme.programme_date == prog_date).first()
    if not prog:
        raise HTTPException(status_code=404, detail="Programme introuvable pour cette date")
    return prog


@router.post("", response_model=ProgrammeOut, status_code=status.HTTP_201_CREATED)
def create_programme(
    body: ProgrammeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dn),
):
    """DN creates the J+1 programme."""
    existing = db.query(Programme).filter(Programme.programme_date == body.programme_date).first()
    if existing:
        raise HTTPException(status_code=409, detail="Un programme existe déjà pour cette date")

    prog = Programme(programme_date=body.programme_date, created_by=current_user.id)
    db.add(prog)
    db.flush()  # get prog.id before adding slots

    for slot_data in body.slots:
        slot = ProgrammeSlot(programme_id=prog.id, **slot_data.model_dump())
        db.add(slot)

    db.commit()
    db.refresh(prog)
    return prog


@router.patch("/{programme_id}/slots", response_model=ProgrammeOut)
def update_slots(
    programme_id: int,
    slots: list[SlotUpdate],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    """CRC or BCC updates their slots in an existing programme."""
    prog = db.get(Programme, programme_id)
    if not prog:
        raise HTTPException(status_code=404, detail="Programme introuvable")
    if prog.status == "completed":
        raise HTTPException(status_code=409, detail="Programme déjà complété")

    for slot_data in slots:
        slot = db.query(ProgrammeSlot).filter(
            ProgrammeSlot.programme_id == programme_id,
            ProgrammeSlot.time_slot == slot_data.time_slot,
            ProgrammeSlot.bcc_id == slot_data.bcc_id,
        ).first()

        if slot:
            for field, value in slot_data.model_dump(exclude_unset=True).items():
                setattr(slot, field, value)
        else:
            db.add(ProgrammeSlot(programme_id=programme_id, **slot_data.model_dump()))

    db.commit()
    db.refresh(prog)
    return prog


@router.patch("/{programme_id}/validate", response_model=ProgrammeOut)
def validate_programme(
    programme_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_dn),
):
    prog = db.get(Programme, programme_id)
    if not prog:
        raise HTTPException(status_code=404, detail="Programme introuvable")
    prog.status = "validated"
    db.commit()
    db.refresh(prog)
    return prog
