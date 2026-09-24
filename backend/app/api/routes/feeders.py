from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_bcc
from app.core.database import get_db
from app.models.network import Feeder
from app.models.user import User
from app.schemas.feeder import FeederCreate, FeederOut, FeederUpdate

router = APIRouter(prefix="/feeders", tags=["feeders"])


def _get_feeder_or_404(feeder_id: int, db: Session) -> Feeder:
    f = db.get(Feeder, feeder_id)
    if not f:
        raise HTTPException(status_code=404, detail="Départ introuvable")
    return f


def _check_bcc_ownership(feeder: Feeder, user: User) -> None:
    """BCC operators can only touch feeders belonging to their own BCC."""
    if user.role == "BCC" and feeder.bcc_id != user.bcc_id:
        raise HTTPException(status_code=403, detail="Accès refusé — départ d'un autre BCC")


@router.get("", response_model=list[FeederOut])
def list_feeders(
    bcc_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    """
    Return feeders.
    - BCC operators always see only their own BCC's feeders.
    - CRC/DN can filter by bcc_id or get all.
    """
    q = db.query(Feeder)
    if current_user.role == "BCC":
        q = q.filter(Feeder.bcc_id == current_user.bcc_id)
    elif bcc_id:
        q = q.filter(Feeder.bcc_id == bcc_id)
    return q.order_by(Feeder.priority, Feeder.ref).all()


@router.post("", response_model=FeederOut, status_code=status.HTTP_201_CREATED)
def create_feeder(
    body: FeederCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    bcc_id = current_user.bcc_id if current_user.role == "BCC" else None
    if not bcc_id:
        raise HTTPException(status_code=400, detail="bcc_id requis pour les opérateurs DN/CRC")

    # Prevent duplicate refs within the same BCC
    exists = db.query(Feeder).filter(
        Feeder.bcc_id == bcc_id, Feeder.ref == body.ref
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail=f"Référence {body.ref} déjà existante pour ce BCC")

    feeder = Feeder(**body.model_dump(), bcc_id=bcc_id)
    db.add(feeder)
    db.commit()
    db.refresh(feeder)
    return feeder


@router.put("/{feeder_id}", response_model=FeederOut)
def update_feeder(
    feeder_id: int,
    body: FeederUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    feeder = _get_feeder_or_404(feeder_id, db)
    _check_bcc_ownership(feeder, current_user)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(feeder, field, value)

    db.commit()
    db.refresh(feeder)
    return feeder


@router.delete("/{feeder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feeder(
    feeder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_bcc),
):
    feeder = _get_feeder_or_404(feeder_id, db)
    _check_bcc_ownership(feeder, current_user)
    db.delete(feeder)
    db.commit()
