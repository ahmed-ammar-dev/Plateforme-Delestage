import sys
sys.path.insert(0, '.')
from datetime import datetime, timezone
from sqlalchemy import func
from app.core.database import SessionLocal
from app.models.execution import Execution
from app.models.network import Feeder, BCC

db = SessionLocal()
now = datetime.now(timezone.utc)

# Check all BCCs for feeders that are in cooldown per DB but shouldn't be selectable
bccs = db.query(BCC).order_by(BCC.name).all()

for bcc in bccs:
    feeders = (db.query(Feeder)
               .filter(Feeder.bcc_id == bcc.id, Feeder.priority != 'P0')
               .order_by(Feeder.ref).all())
    feeder_ids = [f.id for f in feeders]

    rows = (db.query(Execution.feeder_id, func.max(Execution.started_at).label("last_cut"))
            .filter(Execution.feeder_id.in_(feeder_ids))
            .group_by(Execution.feeder_id).all())
    last_cut_map = {r.feeder_id: r.last_cut for r in rows}

    cooldowns = []
    for f in feeders:
        lc = last_cut_map.get(f.id)
        if lc:
            if lc.tzinfo is None: lc = lc.replace(tzinfo=timezone.utc)
            hours = (now - lc).total_seconds() / 3600
            if hours < 8:
                cooldowns.append(f"{f.ref}({hours:.1f}h)")

    if cooldowns:
        print(f"{bcc.name}: COOLDOWN feeders = {', '.join(cooldowns)}")
    else:
        print(f"{bcc.name}: all available")

db.close()
