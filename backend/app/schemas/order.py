from datetime import datetime
from pydantic import BaseModel, Field


class OrderCreate(BaseModel):
    order_type: str = Field(..., pattern="^(urgence|realim)$")
    sub_type: str | None = None          # 'partielle' | 'totale'
    mw_total: float = Field(..., gt=0)
    mw_nord: float = Field(default=0.0)
    mw_sud: float = Field(default=0.0)
    target_crc_id: int | None = None     # None = both CRCs
    notes: str | None = None


class OrderAckUpdate(BaseModel):
    """CRC/BCC presses Reçu (step 1)."""
    bcc_id: int | None = None
    mw_assigned: float = 0.0


class OrderExecuteUpdate(BaseModel):
    """BCC confirms execution (step 2)."""
    mw_executed: float


class OrderAckOut(BaseModel):
    id: int
    order_id: int
    user_id: int
    bcc_id: int | None
    mw_assigned: float
    mw_executed: float
    acked_at: datetime | None
    executed_at: datetime | None
    status: str

    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: int
    order_ref: str
    order_type: str
    sub_type: str | None
    mw_total: float
    mw_nord: float
    mw_sud: float
    issued_by: int
    issued_at: datetime
    target_crc_id: int | None
    status: str
    cancelled_by: int | None
    cancelled_at: datetime | None
    notes: str | None
    acks: list[OrderAckOut] = []

    model_config = {"from_attributes": True}
