from __future__ import annotations

from datetime import timezone

from .models import Dataset, Intervention, Run, Scenario, User

PARAM_FIELDS = ["delay_min", "arrival_min", "mode", "speed_ms", "night", "night_factor", "buffer_min", "detour_threshold"]


def iso(dt):
    """ISO 8601 dengan zona; SQLite mengembalikan datetime naif yang sebenarnya UTC."""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "active": u.active, "created_at": iso(u.created_at)}


def dataset_out(d: Dataset, full: bool = False) -> dict:
    out = {
        "id": d.id,
        "name": d.name,
        "version": d.version,
        "status": d.status,
        "checksum": d.checksum,
        "source": d.source,
        "license": d.license,
        "license_open": d.license_open,
        "accessed_at": d.accessed_at,
        "notes": d.notes,
        "files": d.files or {},
        "stats": d.stats,
        "parent_id": d.parent_id,
        "created_at": iso(d.created_at),
        "published_at": iso(d.published_at),
        "has_errors": bool(d.validation and d.validation.get("errors")),
        "warning_count": len((d.validation or {}).get("warnings", [])),
    }
    if full:
        out["validation"] = d.validation
    return out


def scenario_out(s: Scenario, creator: str | None = None, last_run: Run | None = None, interventions: list[Intervention] | None = None) -> dict:
    out = {
        "id": s.id,
        "dataset_id": s.dataset_id,
        "name": s.name,
        "description": s.description,
        "preset": s.preset,
        **{f: getattr(s, f) for f in PARAM_FIELDS},
        "monte_carlo": s.monte_carlo or {},
        "archived": s.archived,
        "history": s.history or [],
        "created_by": creator,
        "created_at": iso(s.created_at),
        "updated_at": iso(s.updated_at),
        "last_run": run_out(last_run) if last_run else None,
    }
    if interventions is not None:
        out["interventions"] = [intervention_out(i) for i in interventions]
    return out


def intervention_out(i: Intervention) -> dict:
    return {"id": i.id, "type": i.type, "label": i.label, "payload": i.payload, "enabled": i.enabled, "created_at": iso(i.created_at)}


def run_out(r: Run) -> dict:
    return {
        "id": r.id,
        "scenario_id": r.scenario_id,
        "dataset_id": r.dataset_id,
        "kind": r.kind,
        "label": r.label,
        "with_interventions": r.with_interventions,
        "base_run_id": r.base_run_id,
        "status": r.status,
        "progress": r.progress,
        "stage": r.stage,
        "input_hash": r.input_hash,
        "engine_version": r.engine_version,
        "seed": r.seed,
        "params": {k: v for k, v in (r.params or {}).items() if not k.startswith("_")},
        "mc": (r.params or {}).get("_mc"),
        "interventions": r.interventions or [],
        "shelters_extra": r.shelters_extra or [],
        "summary": r.summary,
        "error": r.error,
        "created_at": iso(r.created_at),
        "started_at": iso(r.started_at),
        "finished_at": iso(r.finished_at),
        "duration_s": r.duration_s,
    }
