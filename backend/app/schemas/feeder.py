from pydantic import BaseModel, Field


class FeederBase(BaseModel):
    ref: str = Field(..., max_length=16)
    nom: str = Field(..., max_length=128)
    poste_source: str = Field(..., max_length=64)
    zone: str = Field(..., max_length=64)
    mw_nominal: float = Field(..., gt=0)
    priority: str = Field(..., pattern="^P[0-5]$")
    statut: str = Field(default="Actif")


class FeederCreate(FeederBase):
    pass


class FeederUpdate(BaseModel):
    nom: str | None = None
    poste_source: str | None = None
    zone: str | None = None
    mw_nominal: float | None = None
    priority: str | None = None
    statut: str | None = None


class FeederOut(FeederBase):
    id: int
    bcc_id: int

    model_config = {"from_attributes": True}
