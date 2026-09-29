"""
Settings route — lightweight key/value store backed by a JSON file.

Endpoints:
  GET  /api/v1/settings/crc-split   → { split_nord, split_sud, intervalle_min_heures }
  PUT  /api/v1/settings/crc-split   → { split_nord?, intervalle_min_heures? }  (DN only)
"""
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user, require_dn
from app.models.user import User

router = APIRouter(prefix="/settings", tags=["settings"])

# ── Persistence ───────────────────────────────────────────────────────────────
_SETTINGS_PATH = Path(__file__).parent.parent.parent / "data" / "settings.json"

_DEFAULTS: dict[str, Any] = {
    "split_nord":            67,   # % allocated to CRC Nord
    "intervalle_min_heures":  8,   # minimum hours between cuts for same feeder
}


def _load() -> dict[str, Any]:
    try:
        if _SETTINGS_PATH.exists():
            with open(_SETTINGS_PATH, "r", encoding="utf-8") as f:
                return {**_DEFAULTS, **json.load(f)}
    except Exception:
        pass
    return dict(_DEFAULTS)


def _save(data: dict[str, Any]) -> None:
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ── Schemas ───────────────────────────────────────────────────────────────────
class SettingsIn(BaseModel):
    split_nord:            int | None = Field(None, ge=0, le=100)
    intervalle_min_heures: int | None = Field(None, ge=1, le=168,
                                               description="Cooldown en heures (1–168h = 1 semaine)")


class SettingsOut(BaseModel):
    split_nord:            int
    split_sud:             int
    intervalle_min_heures: int


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/crc-split", response_model=SettingsOut)
def get_settings(current_user: User = Depends(get_current_user)) -> SettingsOut:
    """Return all operational settings."""
    data = _load()
    nord = int(data.get("split_nord", _DEFAULTS["split_nord"]))
    return SettingsOut(
        split_nord            = nord,
        split_sud             = 100 - nord,
        intervalle_min_heures = int(data.get("intervalle_min_heures",
                                             _DEFAULTS["intervalle_min_heures"])),
    )


@router.put("/crc-split", response_model=SettingsOut)
def update_settings(
    body: SettingsIn,
    current_user: User = Depends(require_dn),
) -> SettingsOut:
    """DN updates operational settings (partial update)."""
    data = _load()
    if body.split_nord            is not None:
        data["split_nord"]            = body.split_nord
    if body.intervalle_min_heures is not None:
        data["intervalle_min_heures"] = body.intervalle_min_heures
    _save(data)
    nord = int(data["split_nord"])
    return SettingsOut(
        split_nord            = nord,
        split_sud             = 100 - nord,
        intervalle_min_heures = int(data["intervalle_min_heures"]),
    )
