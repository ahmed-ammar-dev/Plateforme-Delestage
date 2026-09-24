from datetime import datetime
from pydantic import BaseModel, Field


class ExecutionCreate(BaseModel):
    feeder_id: int
    mw_shed: float = Field(..., gt=0)
    trigger: str = Field(default="manual", pattern="^(j1|urgence|manual)$")
    order_id: int | None = None
    notes: str | None = None


class ExecutionRestore(BaseModel):
    notes: str | None = None


class ExecutionOut(BaseModel):
    id: int
    feeder_id: int
    bcc_id: int
    operator_id: int
    order_id: int | None
    started_at: datetime
    ended_at: datetime | None
    duration_min: float | None
    mw_shed: float
    ens_mwh: float | None
    trigger: str
    status: str
    notes: str | None

    model_config = {"from_attributes": True}
