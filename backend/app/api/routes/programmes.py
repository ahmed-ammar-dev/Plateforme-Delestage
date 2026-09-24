from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_bcc, require_dn
from app.core.database import get_db
from app.models.programme import Programme, ProgrammeSlot
from app.models.user import User
from app.schemas.programme import ProgrammeCreate, ProgrammeOut, SlotUpdate

router = APIRouter(prefix="/programmes", tags=["programmes"])


@router.get("", response_model=list[ProgrammeOut])
def list_programmes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Programme).order_by(Programme.programme_date.desc()).limit(30).all()


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
