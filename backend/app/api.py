"""API JSON Sempat (PRD 8.2). Semua galat memakai bentuk {code, message, hint}."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import jobs, reports
from .config import DATA_DIR, MAX_UPLOAD_BYTES, PUBLIC_MIN_CELL_POP, SESSION_HOURS, COOKIE_SECURE
from .datasets import checksum, clone_dataset, load_bundle, store_parsed, validate_and_grid
from .db import get_db
from .engine import ENGINE_VERSION
from .engine.compute import DEFAULT_SPEEDS, MATRIX_ARRIVALS, MATRIX_DELAYS, MATRIX_MODES
from .engine.geo import points_to_lonlat
from .engine.graph import route_nodes
from .importers import ALLOWED_EXT, KINDS, PARSERS, ImportError_, sniff_ok
from .models import (
    Area,
    AreaResult,
    AuditLog,
    CellResult,
    Dataset,
    InundationZone,
    Intervention,
    PopulationCell,
    PriorityItem,
    Report,
    RoadSegment,
    Run,
    Scenario,
    SessionToken,
    ShareLink,
    Shelter,
    ShelterResult,
    Siren,
    User,
    now,
)
from .security import (
    COOKIE_NAME,
    ApiError,
    audit,
    create_session,
    current_user,
    hash_password,
    login_limiter,
    require_role,
    verify_password,
)
from .serializers import PARAM_FIELDS, iso, dataset_out, intervention_out, run_out, scenario_out, user_out

router = APIRouter(prefix="/api")

PRESETS = {
    "esai_2026": {
        "label": "Esai 2026",
        "description": "Jeda 5 menit, gelombang tiba 20 menit, jalan kaki 1,09 m/detik.",
        "delay_min": 5.0,
        "arrival_min": 20.0,
        "mode": "jalan_kaki",
        "speed_ms": 1.09,
        "night": False,
        "night_factor": 0.75,
        "buffer_min": 2.0,
        "detour_threshold": 1.5,
    },
    "fachri_2022": {
        "label": "Fachri 2022",
        "description": "Kecepatan turunan Fachri (2022): 1.047,38 m dalam 16 menit; jeda 0, gelombang 25 menit.",
        "delay_min": 0.0,
        "arrival_min": 25.0,
        "mode": "jalan_kaki",
        "speed_ms": 1.09,
        "night": False,
        "night_factor": 0.75,
        "buffer_min": 2.0,
        "detour_threshold": 1.5,
    },
}

MC_DEFAULT = {
    "n": 1000,
    "seed": None,
    "delay": [0.0, 5.0, 15.0],
    "arrival": [10.0, 20.0, 35.0],
    "speed": {"jalan_kaki": [0.75, 1.09, 1.4], "kendaraan": [1.5, 2.49, 4.0]},
}

PARAMETER_SOURCES = [
    {"key": "delay_min", "symbol": "τ", "label": "Jeda respons", "value": "0, 5, 10 menit", "source": "Rentang skenario esai; dapat diubah pengguna", "status": "perlu kalibrasi"},
    {"key": "arrival_min", "symbol": "T_a", "label": "Waktu tiba gelombang", "value": "20 dan 25 menit", "source": "20 menit: jendela Triatmadja & Nasution (2014); 25 menit: Ar dkk. (2025)", "status": "berbasis literatur"},
    {"key": "speed_walk", "symbol": "v_jalan", "label": "Kecepatan jalan kaki", "value": "1,09 m/detik", "source": "Turunan 1.047,38 m ÷ 16 menit dari Fachri (2022); pembanding 1,4–1,6 m/detik pada Triatmadja & Nasution (2014)", "status": "berbasis literatur"},
    {"key": "speed_vehicle", "symbol": "v_kendaraan", "label": "Kecepatan kendaraan", "value": "2,49 m/detik", "source": "Turunan 1.047,38 m ÷ 7 menit dari Fachri (2022)", "status": "berbasis literatur"},
    {"key": "night_factor", "symbol": "f_malam", "label": "Faktor malam", "value": "0,75", "source": "Nilai awal; kajian terdahulu mengurangi kecepatan pada malam hari", "status": "perlu kalibrasi"},
    {"key": "buffer_min", "symbol": "b", "label": "Margin pengaman", "value": "2 menit", "source": "Nilai awal yang harus dikalibrasi bersama BPBD", "status": "perlu kalibrasi"},
    {"key": "cell_size", "symbol": "—", "label": "Ukuran sel", "value": "100 m", "source": "Kompromi akurasi dan waktu hitung", "status": "keputusan desain"},
    {"key": "detour_threshold", "symbol": "—", "label": "Ambang rasio jarak (aturan 3)", "value": "1,5", "source": "Nilai awal yang dapat diubah", "status": "perlu kalibrasi"},
    {"key": "mc_arrival", "symbol": "T_a (MC)", "label": "Rentang Monte Carlo waktu tiba", "value": "10–35 menit", "source": "Variasi waktu tiba pada kejadian historis yang dilaporkan literatur", "status": "perlu verifikasi sebelum laporan resmi"},
]


# --- Auth --------------------------------------------------------------------------------


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(request.client.host if request.client else "?")
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if not user or not user.active or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "kredensial_salah", "Surel atau kata sandi tidak cocok.", "Periksa ejaan surel dan huruf besar-kecil kata sandi.")
    tok = create_session(db, user)
    response.set_cookie(COOKIE_NAME, tok.token, httponly=True, samesite="lax", secure=COOKIE_SECURE, max_age=int(SESSION_HOURS * 3600), path="/")
    return {"user": user_out(user)}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        s = db.get(SessionToken, token)
        if s:
            db.delete(s)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"user": user_out(user)}


# --- Meta dan dasbor ----------------------------------------------------------------------


@router.get("/meta")
def meta():
    return {
        "engine_version": ENGINE_VERSION,
        "presets": PRESETS,
        "monte_carlo_default": MC_DEFAULT,
        "parameter_sources": PARAMETER_SOURCES,
        "matrix": {"delays": MATRIX_DELAYS, "arrivals": MATRIX_ARRIVALS, "modes": MATRIX_MODES},
        "default_speeds": DEFAULT_SPEEDS,
        "file_kinds": KINDS,
        "allowed_ext": ALLOWED_EXT,
    }


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    datasets = list(db.scalars(select(Dataset).order_by(Dataset.created_at.desc()).limit(5)))
    published = db.scalar(select(Dataset).where(Dataset.status == "terbit").order_by(Dataset.published_at.desc()))
    scen = list(db.scalars(select(Scenario).where(Scenario.archived.is_(False)).order_by(Scenario.updated_at.desc()).limit(5)))
    runs = list(db.scalars(select(Run).order_by(Run.created_at.desc()).limit(8)))
    names = {s.id: s.name for s in db.scalars(select(Scenario).where(Scenario.id.in_({r.scenario_id for r in runs})))}
    my_runs = db.scalar(select(func.count()).select_from(Run).where(Run.created_by == user.id)) or 0
    my_reports = db.scalar(select(func.count()).select_from(Report).where(Report.created_by == user.id)) or 0
    my_scen = db.scalar(select(func.count()).select_from(Scenario).where(Scenario.created_by == user.id)) or 0
    warnings = []
    if published and published.validation:
        warnings = published.validation.get("warnings", [])
    return {
        "published_dataset": dataset_out(published) if published else None,
        "datasets": [dataset_out(d) for d in datasets],
        "scenarios": [scenario_out(s, last_run=_last_run(db, s.id)) for s in scen],
        "runs": [{**run_out(r), "scenario_name": names.get(r.scenario_id, "")} for r in runs],
        "data_warnings": warnings,
        "onboarding": {
            "dataset_ready": published is not None,
            "scenario_created": my_scen > 0,
            "run_done": my_runs > 0,
            "report_made": my_reports > 0,
        },
    }


def _last_run(db: Session, scenario_id: str) -> Run | None:
    return db.scalar(select(Run).where(Run.scenario_id == scenario_id).order_by(Run.created_at.desc()))


# --- Dataset ------------------------------------------------------------------------------


class DatasetIn(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    source: str = ""
    license: str = Field("", max_length=120)
    license_open: bool = False
    accessed_at: str = Field("", max_length=20)
    notes: str = ""


def _ds(db: Session, ds_id: str) -> Dataset:
    ds = db.get(Dataset, ds_id)
    if not ds:
        raise ApiError(404, "dataset_tidak_ada", "Dataset tidak ditemukan.", "Muat ulang halaman Data.")
    return ds


def _require_draft(ds: Dataset):
    if ds.status == "terbit":
        raise ApiError(409, "dataset_beku", "Dataset terbit tidak dapat diubah.", "Buat versi baru dari dataset ini untuk koreksi.")


@router.get("/datasets")
def list_datasets(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"items": [dataset_out(d) for d in db.scalars(select(Dataset).order_by(Dataset.name, Dataset.version.desc()))]}


@router.post("/datasets", status_code=201)
def create_dataset(body: DatasetIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    latest = db.scalar(select(func.max(Dataset.version)).where(Dataset.name == body.name)) or 0
    ds = Dataset(**body.model_dump(), version=latest + 1, created_by=user.id)
    db.add(ds)
    db.flush()
    audit(db, user, "buat_dataset", f"dataset:{ds.id}", {"name": ds.name})
    db.commit()
    return dataset_out(ds)


@router.get("/datasets/{ds_id}")
def get_dataset(ds_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return dataset_out(_ds(db, ds_id), full=True)


@router.patch("/datasets/{ds_id}")
def patch_dataset(ds_id: str, body: DatasetIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    ds = _ds(db, ds_id)
    _require_draft(ds)
    for k, v in body.model_dump().items():
        setattr(ds, k, v)
    db.commit()
    return dataset_out(ds, full=True)


@router.post("/datasets/{ds_id}/files")
async def upload_file(ds_id: str, kind: str = Query(...), file: UploadFile = File(...), user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    ds = _ds(db, ds_id)
    _require_draft(ds)
    if kind not in PARSERS:
        raise ApiError(400, "jenis_tidak_dikenal", f"Jenis berkas '{kind}' tidak dikenal.", "Pilih salah satu: " + ", ".join(KINDS))
    name = file.filename or "berkas"
    if not name.lower().endswith(ALLOWED_EXT[kind]):
        raise ApiError(400, "format_ditolak", f"Format {name} tidak diterima untuk {KINDS[kind]}.", "Format yang diterima: " + ", ".join(ALLOWED_EXT[kind]))
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "berkas_terlalu_besar", "Berkas melebihi 100 MB.", "Pecah berkas per kecamatan atau sederhanakan geometri.")
    if not sniff_ok(data, name):
        raise ApiError(400, "isi_tidak_cocok", "Isi berkas tidak cocok dengan ekstensinya.", "Pastikan berkas tidak rusak dan berformat sesuai ekstensi.")
    try:
        parsed = PARSERS[kind](data, name)
    except ImportError_ as e:
        raise ApiError(400, "impor_gagal", e.message, e.hint)
    store_parsed(db, ds, kind, parsed)
    files = dict(ds.files or {})
    files[kind] = {
        "name": name,
        "size": len(data),
        "rows_ok": len(parsed.rows),
        "rows_rejected": len(parsed.rejected),
        "rejected": parsed.rejected[:200],
        "warnings": parsed.warnings[:50],
        "crs": parsed.crs,
        "uploaded_at": now().isoformat(),
    }
    ds.files = files
    audit(db, user, "unggah", f"dataset:{ds.id}", {"kind": kind, "file": name, "ok": len(parsed.rows), "ditolak": len(parsed.rejected)})
    db.commit()
    return {"dataset": dataset_out(ds, full=True), "file": files[kind]}


@router.post("/datasets/{ds_id}/validate")
def validate_dataset(ds_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    ds = _ds(db, ds_id)
    _require_draft(ds)
    validate_and_grid(db, ds)
    db.commit()
    return dataset_out(ds, full=True)


@router.get("/datasets/{ds_id}/validation")
def get_validation(ds_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ds = _ds(db, ds_id)
    return {"validation": ds.validation, "files": ds.files}


@router.post("/datasets/{ds_id}/publish")
def publish_dataset(ds_id: str, user: User = Depends(require_role("analis")), db: Session = Depends(get_db)):
    ds = _ds(db, ds_id)
    _require_draft(ds)
    if ds.status != "tervalidasi":
        raise ApiError(409, "belum_valid", "Dataset belum lulus validasi.", "Jalankan validasi dan selesaikan semua galat kritis terlebih dahulu.")
    if not ds.source or not ds.license or not ds.accessed_at:
        raise ApiError(409, "tata_kelola", "Sumber, lisensi, dan tanggal akses wajib diisi sebelum terbit.", "Lengkapi metadata dataset di bagian atas halaman.")
    ds.checksum = checksum(db, ds)
    ds.status = "terbit"
    ds.published_at = now()
    audit(db, user, "terbit", f"dataset:{ds.id}", {"version": ds.version, "checksum": ds.checksum})
    db.commit()
    return dataset_out(ds, full=True)


@router.post("/datasets/{ds_id}/new-version", status_code=201)
def new_version(ds_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    src = _ds(db, ds_id)
    new = clone_dataset(db, src, user.id)
    audit(db, user, "versi_baru", f"dataset:{new.id}", {"dari": src.id})
    db.commit()
    return dataset_out(new, full=True)


@router.get("/datasets/{ds_id}/layers")
def dataset_layers(ds_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _layers(db, _ds(db, ds_id), public=False)


def _layers(db: Session, ds: Dataset, public: bool) -> dict:
    areas = list(db.scalars(select(Area).where(Area.dataset_id == ds.id)))

    def fc(items):
        return {"type": "FeatureCollection", "features": items}

    kec = [{"type": "Feature", "properties": {"code": a.code, "name": a.name}, "geometry": a.geom} for a in areas if a.level == "kecamatan" and a.geom]
    kel = [{"type": "Feature", "properties": {"code": a.code, "name": a.name, "parent": a.parent_code, "population": a.population}, "geometry": a.geom} for a in areas if a.level == "kelurahan" and a.geom]
    zones = [{"type": "Feature", "properties": {"source": z.source}, "geometry": z.geom} for z in db.scalars(select(InundationZone).where(InundationZone.dataset_id == ds.id))]
    shel = [
        {
            "type": "Feature",
            "properties": {"id": s.id, "name": s.name, "type": s.type, "capacity": s.capacity, "flag": s.flag, "note": s.note, "status": s.status},
            "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]},
        }
        for s in db.scalars(select(Shelter).where(Shelter.dataset_id == ds.id))
    ]
    sir = [
        {"type": "Feature", "properties": {"name": s.name, "status": s.status}, "geometry": {"type": "Point", "coordinates": [s.lon, s.lat]}}
        for s in db.scalars(select(Siren).where(Siren.dataset_id == ds.id))
    ]
    bounds = None
    if kec or kel:
        xs, ys = [], []
        for f in kec or kel:
            _collect(f["geometry"]["coordinates"], xs, ys)
        bounds = [min(xs), min(ys), max(xs), max(ys)]
    return {"kecamatan": fc(kec), "kelurahan": fc(kel), "zones": fc(zones), "shelters": fc(shel), "sirens": fc(sir), "bounds": bounds}


def _collect(c, xs, ys):
    if isinstance(c[0], (int, float)):
        xs.append(c[0])
        ys.append(c[1])
    else:
        for x in c:
            _collect(x, xs, ys)


@router.get("/datasets/{ds_id}/roads")
def dataset_roads(ds_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    feats = [
        {"type": "Feature", "id": i, "properties": {"id": r.id, "class": r.road_class, "name": r.name, "length_m": round(r.length_m, 1)}, "geometry": {"type": "LineString", "coordinates": r.coords}}
        for i, r in enumerate(db.scalars(select(RoadSegment).where(RoadSegment.dataset_id == ds_id)))
    ]
    return {"type": "FeatureCollection", "features": feats}


# --- Skenario -----------------------------------------------------------------------------


class MonteCarloIn(BaseModel):
    n: int = Field(1000, ge=100, le=5000)
    seed: int | None = None
    delay: list[float] = Field(default_factory=lambda: [0.0, 5.0, 15.0], min_length=3, max_length=3)
    arrival: list[float] = Field(default_factory=lambda: [10.0, 20.0, 35.0], min_length=3, max_length=3)
    speed: list[float] | None = None


class ScenarioIn(BaseModel):
    dataset_id: str | None = None
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = None
    preset: str | None = None
    delay_min: float | None = None
    arrival_min: float | None = None
    mode: Literal["jalan_kaki", "kendaraan"] | None = None
    speed_ms: float | None = None
    night: bool | None = None
    night_factor: float | None = None
    buffer_min: float | None = None
    detour_threshold: float | None = None
    monte_carlo: MonteCarloIn | None = None


def _validate_params(s: Scenario):
    errs = []
    if s.delay_min < 0:
        errs.append("Jeda respons τ harus ≥ 0 menit.")
    if s.arrival_min <= 0:
        errs.append("Waktu tiba T_a harus > 0 menit.")
    if s.speed_ms <= 0:
        errs.append("Kecepatan v harus > 0 m/detik.")
    if not (0 < s.night_factor <= 1):
        errs.append("Faktor malam harus di antara 0 dan 1.")
    if s.buffer_min < 0:
        errs.append("Margin pengaman b harus ≥ 0 menit.")
    if s.detour_threshold <= 1:
        errs.append("Ambang rasio jarak harus > 1.")
    mc = s.monte_carlo or {}
    for k in ("delay", "arrival", "speed"):
        tri = mc.get(k)
        if tri and not (tri[0] <= tri[1] <= tri[2] and tri[0] < tri[2]):
            errs.append(f"Sebaran segitiga {k} harus memenuhi minimum ≤ modus ≤ maksimum.")
    if errs:
        raise ApiError(422, "parameter_tidak_sah", " ".join(errs), "Perbaiki nilai yang ditandai lalu simpan lagi.")


def _sc(db: Session, sc_id: str) -> Scenario:
    s = db.get(Scenario, sc_id)
    if not s:
        raise ApiError(404, "skenario_tidak_ada", "Skenario tidak ditemukan.", "Kembali ke daftar skenario.")
    return s


def _scenario_full(db: Session, s: Scenario) -> dict:
    creator = db.get(User, s.created_by) if s.created_by else None
    ivs = list(db.scalars(select(Intervention).where(Intervention.scenario_id == s.id).order_by(Intervention.created_at)))
    ds = db.get(Dataset, s.dataset_id)
    out = scenario_out(s, creator.name if creator else None, _last_run(db, s.id), ivs)
    out["dataset"] = dataset_out(ds) if ds else None
    return out


@router.get("/scenarios")
def list_scenarios(include_archived: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Scenario).order_by(Scenario.updated_at.desc())
    if not include_archived:
        q = q.where(Scenario.archived.is_(False))
    items = []
    users = {u.id: u.name for u in db.scalars(select(User))}
    for s in db.scalars(q):
        last_ok = db.scalar(select(Run).where(Run.scenario_id == s.id, Run.status == "selesai").order_by(Run.finished_at.desc()))
        out = scenario_out(s, users.get(s.created_by), _last_run(db, s.id))
        out["last_completed_run"] = run_out(last_ok) if last_ok else None
        items.append(out)
    return {"items": items}


@router.post("/scenarios", status_code=201)
def create_scenario(body: ScenarioIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    ds_id = body.dataset_id
    if not ds_id:
        pub = db.scalar(select(Dataset).where(Dataset.status == "terbit").order_by(Dataset.published_at.desc()))
        if not pub:
            raise ApiError(409, "belum_ada_dataset", "Belum ada dataset terbit.", "Impor dan terbitkan dataset di halaman Data.")
        ds_id = pub.id
    ds = _ds(db, ds_id)
    if ds.status != "terbit":
        raise ApiError(409, "dataset_belum_terbit", "Skenario hanya dapat memakai dataset terbit.", "Terbitkan dataset terlebih dahulu.")
    base = dict(PRESETS.get(body.preset or "esai_2026", PRESETS["esai_2026"]))
    vals = {k: v for k, v in body.model_dump(exclude={"monte_carlo", "dataset_id"}).items() if v is not None}
    params = {f: vals.get(f, base[f]) for f in PARAM_FIELDS}
    if "mode" in vals and "speed_ms" not in vals:
        params["speed_ms"] = DEFAULT_SPEEDS[vals["mode"]]
    mc = (body.monte_carlo.model_dump() if body.monte_carlo else {k: v for k, v in MC_DEFAULT.items() if k != "speed"})
    if not mc.get("speed"):
        mc["speed"] = MC_DEFAULT["speed"][params["mode"]]
    s = Scenario(
        dataset_id=ds.id,
        created_by=user.id,
        name=vals.get("name") or f"{base['label']} — {datetime.now().strftime('%d %b %H:%M')}",
        description=vals.get("description", base.get("description", "")),
        preset=body.preset,
        monte_carlo=mc,
        history=[{"at": now().isoformat(), "by": user.name, "change": "dibuat", "values": params}],
        **params,
    )
    _validate_params(s)
    db.add(s)
    db.flush()
    audit(db, user, "buat_skenario", f"skenario:{s.id}", {"name": s.name})
    db.commit()
    return _scenario_full(db, s)


@router.get("/scenarios/{sc_id}")
def get_scenario(sc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _scenario_full(db, _sc(db, sc_id))


@router.patch("/scenarios/{sc_id}")
def patch_scenario(sc_id: str, body: ScenarioIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    changes = {}
    for k, v in body.model_dump(exclude={"monte_carlo", "dataset_id"}, exclude_none=True).items():
        if getattr(s, k) != v:
            changes[k] = {"dari": getattr(s, k), "ke": v}
            setattr(s, k, v)
    if body.monte_carlo is not None:
        mc = body.monte_carlo.model_dump()
        if not mc.get("speed"):
            mc["speed"] = MC_DEFAULT["speed"][s.mode]
        if mc != s.monte_carlo:
            changes["monte_carlo"] = {"dari": s.monte_carlo, "ke": mc}
            s.monte_carlo = mc
    _validate_params(s)
    if changes:
        s.history = [*(s.history or []), {"at": now().isoformat(), "by": user.name, "change": "ubah", "values": changes}]
        s.updated_at = now()
        audit(db, user, "ubah_skenario", f"skenario:{s.id}", {"fields": list(changes)})
    db.commit()
    return _scenario_full(db, s)


@router.post("/scenarios/{sc_id}/copy", status_code=201)
def copy_scenario(sc_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    n = Scenario(
        dataset_id=s.dataset_id,
        created_by=user.id,
        name=f"Salinan {s.name}"[:200],
        description=s.description,
        preset=s.preset,
        monte_carlo=dict(s.monte_carlo or {}),
        history=[{"at": now().isoformat(), "by": user.name, "change": f"disalin dari {s.name}"}],
        **{f: getattr(s, f) for f in PARAM_FIELDS},
    )
    db.add(n)
    db.flush()
    for iv in db.scalars(select(Intervention).where(Intervention.scenario_id == s.id)):
        db.add(Intervention(scenario_id=n.id, type=iv.type, label=iv.label, payload=dict(iv.payload), enabled=iv.enabled))
    audit(db, user, "salin_skenario", f"skenario:{n.id}", {"dari": s.id})
    db.commit()
    return _scenario_full(db, n)


@router.post("/scenarios/{sc_id}/archive")
def archive_scenario(sc_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    s.archived = not s.archived
    s.history = [*(s.history or []), {"at": now().isoformat(), "by": user.name, "change": "diarsipkan" if s.archived else "dipulihkan"}]
    audit(db, user, "arsip_skenario" if s.archived else "pulihkan_skenario", f"skenario:{s.id}")
    db.commit()
    return _scenario_full(db, s)


class InterventionIn(BaseModel):
    type: Literal["tambah_tes", "blokir_ruas", "kurangi_jeda"]
    label: str = ""
    payload: dict
    enabled: bool = True


def _check_intervention(db: Session, s: Scenario, body: InterventionIn):
    p = body.payload
    if body.type == "tambah_tes":
        try:
            lon, lat = float(p["lon"]), float(p["lat"])
        except (KeyError, TypeError, ValueError):
            raise ApiError(422, "intervensi_tidak_sah", "TES hipotetis memerlukan koordinat lon dan lat.", "Klik titik pada peta untuk menaruh TES.")
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ApiError(422, "intervensi_tidak_sah", "Koordinat TES hipotetis di luar rentang.", "Klik titik di dalam wilayah kota.")
        cap = p.get("capacity")
        if cap not in (None, "") and float(cap) < 0:
            raise ApiError(422, "intervensi_tidak_sah", "Kapasitas tidak boleh negatif.", "Kosongkan bila belum diketahui.")
    elif body.type == "blokir_ruas":
        ids = p.get("segment_ids") or []
        if not ids:
            raise ApiError(422, "intervensi_tidak_sah", "Pilih minimal satu ruas jalan.", "Klik ruas jalan pada peta untuk memblokirnya.")
        found = db.scalar(select(func.count()).select_from(RoadSegment).where(RoadSegment.dataset_id == s.dataset_id, RoadSegment.id.in_(ids)))
        if found != len(set(ids)):
            raise ApiError(422, "intervensi_tidak_sah", "Sebagian ruas tidak ada pada dataset skenario.", "Pilih ulang ruas dari peta.")
    elif body.type == "kurangi_jeda":
        try:
            v = float(p.get("minus_min"))
        except (TypeError, ValueError):
            raise ApiError(422, "intervensi_tidak_sah", "Isi besar penurunan jeda dalam menit.", "Contoh: 3 berarti jeda turun 3 menit.")
        if v <= 0:
            raise ApiError(422, "intervensi_tidak_sah", "Penurunan jeda harus lebih dari 0 menit.", "Contoh: 3 berarti jeda turun 3 menit.")


@router.post("/scenarios/{sc_id}/interventions", status_code=201)
def add_intervention(sc_id: str, body: InterventionIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    _check_intervention(db, s, body)
    iv = Intervention(scenario_id=s.id, **body.model_dump())
    db.add(iv)
    s.history = [*(s.history or []), {"at": now().isoformat(), "by": user.name, "change": f"tambah intervensi {body.type}", "values": body.payload}]
    s.updated_at = now()
    audit(db, user, "tambah_intervensi", f"skenario:{s.id}", {"type": body.type})
    db.commit()
    return intervention_out(iv)


@router.patch("/interventions/{iv_id}")
def patch_intervention(iv_id: str, body: InterventionIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    iv = db.get(Intervention, iv_id)
    if not iv:
        raise ApiError(404, "intervensi_tidak_ada", "Intervensi tidak ditemukan.", "Muat ulang editor skenario.")
    s = _sc(db, iv.scenario_id)
    _check_intervention(db, s, body)
    iv.type, iv.label, iv.payload, iv.enabled = body.type, body.label, body.payload, body.enabled
    s.updated_at = now()
    db.commit()
    return intervention_out(iv)


@router.delete("/interventions/{iv_id}")
def delete_intervention(iv_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    iv = db.get(Intervention, iv_id)
    if not iv:
        raise ApiError(404, "intervensi_tidak_ada", "Intervensi tidak ditemukan.", "Muat ulang editor skenario.")
    s = _sc(db, iv.scenario_id)
    s.history = [*(s.history or []), {"at": now().isoformat(), "by": user.name, "change": f"hapus intervensi {iv.type}"}]
    db.delete(iv)
    db.commit()
    return {"ok": True}


# --- Run ----------------------------------------------------------------------------------


class RunIn(BaseModel):
    kind: Literal["tunggal", "monte_carlo"] = "tunggal"
    with_interventions: bool = False


def _params_snapshot(s: Scenario) -> dict:
    return {f: getattr(s, f) for f in PARAM_FIELDS}


def _create_run(db: Session, s: Scenario, user: User, kind: str, with_iv: bool) -> Run:
    ds = _ds(db, s.dataset_id)
    if ds.status != "terbit":
        raise ApiError(409, "dataset_belum_terbit", "Dataset skenario belum terbit.", "Terbitkan dataset di halaman Data.")
    params = _params_snapshot(s)
    ivs = []
    if with_iv:
        ivs = [{"id": i.id, "type": i.type, "label": i.label, "payload": i.payload} for i in db.scalars(select(Intervention).where(Intervention.scenario_id == s.id, Intervention.enabled.is_(True)).order_by(Intervention.created_at))]
        if not ivs:
            raise ApiError(409, "tanpa_intervensi", "Skenario ini belum memiliki intervensi aktif.", "Tambahkan TES hipotetis, ruas diblokir, atau penurunan jeda.")
    seed = None
    if kind == "monte_carlo":
        mc = dict(s.monte_carlo or {})
        mc.setdefault("n", 1000)
        mc.setdefault("delay", MC_DEFAULT["delay"])
        mc.setdefault("arrival", MC_DEFAULT["arrival"])
        if not mc.get("speed"):
            mc["speed"] = MC_DEFAULT["speed"][s.mode]
        seed = int(mc.get("seed") or secrets.randbelow(2**31 - 1))
        mc["seed"] = seed
        params["_mc"] = mc
    if kind == "matriks":
        params["_speeds"] = {"jalan_kaki": s.speed_ms if s.mode == "jalan_kaki" else DEFAULT_SPEEDS["jalan_kaki"], "kendaraan": s.speed_ms if s.mode == "kendaraan" else DEFAULT_SPEEDS["kendaraan"]}
    h = jobs.input_hash({k: v for k, v in params.items()}, ivs, ds.checksum or "", kind, seed, params.get("_mc"))
    label = {"tunggal": "Tunggal", "matriks": "Matriks 12", "monte_carlo": "Monte Carlo"}[kind] + (" + intervensi" if with_iv else "")
    run = Run(
        scenario_id=s.id,
        dataset_id=ds.id,
        kind=kind,
        with_interventions=with_iv,
        params=params,
        interventions=ivs,
        seed=seed,
        input_hash=h,
        engine_version=ENGINE_VERSION,
        created_by=user.id,
        label=label,
    )
    db.add(run)
    db.flush()
    if with_iv:
        base = db.scalar(
            select(Run).where(Run.scenario_id == s.id, Run.with_interventions.is_(False), Run.kind == "tunggal", Run.status.in_(["selesai", "antrean", "berjalan"])).order_by(Run.created_at.desc())
        )
        if base is None or base.params != {k: v for k, v in params.items() if not k.startswith("_")}:
            base = _create_run(db, s, user, "tunggal", False)
        run.base_run_id = base.id
    audit(db, user, "jalankan", f"run:{run.id}", {"skenario": s.id, "jenis": kind, "intervensi": len(ivs)})
    return run


@router.post("/scenarios/{sc_id}/runs", status_code=202)
def start_run(sc_id: str, body: RunIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    run = _create_run(db, s, user, body.kind, body.with_interventions)
    db.commit()
    queued = [run.id] + ([run.base_run_id] if run.base_run_id else [])
    for rid in sorted(set(queued), key=lambda r: r != run.base_run_id):
        r = db.get(Run, rid)
        if r.status == "antrean":
            jobs.submit(rid)
    return run_out(run)


@router.post("/scenarios/{sc_id}/matrix", status_code=202)
def start_matrix(sc_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    s = _sc(db, sc_id)
    run = _create_run(db, s, user, "matriks", False)
    db.commit()
    jobs.submit(run.id)
    return run_out(run)


def _run(db: Session, run_id: str) -> Run:
    r = db.get(Run, run_id)
    if not r:
        raise ApiError(404, "run_tidak_ada", "Hasil perhitungan tidak ditemukan.", "Kembali ke daftar skenario.")
    return r


def _require_done(r: Run):
    if r.status != "selesai":
        raise ApiError(409, "run_belum_selesai", f"Perhitungan berstatus {r.status}.", "Tunggu sampai status Selesai, atau jalankan ulang bila gagal.")


@router.get("/runs")
def list_runs(scenario_id: str | None = None, status: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Run).order_by(Run.created_at.desc()).limit(200)
    if scenario_id:
        q = q.where(Run.scenario_id == scenario_id)
    if status:
        q = q.where(Run.status == status)
    runs = list(db.scalars(q))
    names = {s.id: s.name for s in db.scalars(select(Scenario).where(Scenario.id.in_({r.scenario_id for r in runs})))}
    return {"items": [{**run_out(r), "scenario_name": names.get(r.scenario_id, "")} for r in runs]}


@router.get("/runs/compare")
def compare_runs(a: str, b: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ra, rb = _run(db, a), _run(db, b)
    _require_done(ra)
    _require_done(rb)
    if ra.dataset_id != rb.dataset_id:
        raise ApiError(409, "dataset_berbeda", "Dua hasil memakai versi dataset berbeda sehingga sel tidak dapat dipasangkan.", "Bandingkan hasil dari dataset yang sama.")
    areas = {x.code: x for x in db.scalars(select(Area).where(Area.dataset_id == ra.dataset_id))}
    A = {r.area_code: r for r in reports.area_rows(db, ra)}
    B = {r.area_code: r for r in reports.area_rows(db, rb)}
    rows = []
    for code in sorted(set(A) | set(B)):
        x, y = A.get(code), B.get(code)
        rows.append(
            {
                "area_code": code,
                "name": areas[code].name if code in areas else "Total kota",
                "level": (x or y).level,
                "parent": areas[code].parent_code if code in areas else None,
                "ik_a": x.ik if x else None,
                "ik_b": y.ik if y else None,
                "delta_ik": (y.ik - x.ik) if x and y and x.ik is not None and y.ik is not None else None,
                "late_a": x.pop_late if x else 0,
                "late_b": y.pop_late if y else 0,
                "pop_total": (x or y).pop_total,
            }
        )
    ca = dict(db.execute(select(CellResult.cell_id, CellResult.cls).where(CellResult.run_id == ra.id)).all())
    cb = dict(db.execute(select(CellResult.cell_id, CellResult.cls).where(CellResult.run_id == rb.id)).all())
    pops = dict(db.execute(select(PopulationCell.id, PopulationCell.population).where(PopulationCell.dataset_id == ra.dataset_id, PopulationCell.in_zone.is_(True))).all())
    classes = ["cukup", "rawan", "terlambat", "terputus"]
    trans = {f: {t: 0.0 for t in classes} for f in classes}
    changed = []
    for cid, cla in ca.items():
        clb = cb.get(cid)
        if clb is None:
            continue
        trans[cla][clb] += pops.get(cid, 0)
        if cla != clb:
            changed.append({"cell_id": cid, "from": cla, "to": clb})
    sempat = ("cukup", "rawan")
    moved_to_sempat = sum(trans["terlambat"][c] + trans["terputus"][c] for c in sempat)
    moved_to_late = sum(trans[c]["terlambat"] for c in sempat)
    la = {r.shelter_id: r for r in db.scalars(select(ShelterResult).where(ShelterResult.run_id == ra.id))}
    lb = {r.shelter_id: r for r in db.scalars(select(ShelterResult).where(ShelterResult.run_id == rb.id))}
    loads = []
    for sid in sorted(set(la) | set(lb)):
        x, y = la.get(sid), lb.get(sid)
        loads.append(
            {
                "shelter_id": sid,
                "name": (y or x).name,
                "hypothetical": (y or x).hypothetical,
                "pop_a": x.assigned_pop if x else 0,
                "pop_b": y.assigned_pop if y else 0,
                "load_a": x.load if x else None,
                "load_b": y.load if y else None,
                "capacity": (y or x).capacity,
            }
        )
    loads.sort(key=lambda r: -abs(r["pop_b"] - r["pop_a"]))
    return {
        "a": run_out(ra),
        "b": run_out(rb),
        "areas": rows,
        "transitions": trans,
        "moved_late_to_sempat": moved_to_sempat,
        "moved_sempat_to_late": moved_to_late,
        "changed_cells": changed[:5000],
        "shelter_loads": loads,
    }


@router.get("/runs/{run_id}")
def get_run(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    s = db.get(Scenario, r.scenario_id)
    ds = db.get(Dataset, r.dataset_id)
    share = db.scalar(select(ShareLink).where(ShareLink.run_id == r.id, ShareLink.revoked.is_(False)))
    return {**run_out(r), "scenario_name": s.name if s else "", "dataset": dataset_out(ds) if ds else None, "share_token": share.token if share else None}


@router.delete("/runs/{run_id}")
def cancel_run(run_id: str, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    if r.status == "antrean":
        r.status = "dibatalkan"
        r.stage = "Dibatalkan pengguna"
        r.finished_at = now()
    elif r.status == "berjalan":
        jobs.cancel(r.id)
    else:
        raise ApiError(409, "tidak_dapat_dibatalkan", f"Run berstatus {r.status} tidak dapat dibatalkan.", "Hanya run dalam antrean atau berjalan yang dapat dibatalkan.")
    audit(db, user, "batalkan", f"run:{r.id}")
    db.commit()
    return run_out(r)


def area_payload(db: Session, r: Run, variant: str = "") -> list[dict]:
    areas = {x.code: x for x in db.scalars(select(Area).where(Area.dataset_id == r.dataset_id))}
    out = []
    for a in reports.area_rows(db, r, variant):
        ar = areas.get(a.area_code)
        out.append(
            {
                "area_code": a.area_code,
                "name": ar.name if ar else "Total kota",
                "parent": ar.parent_code if ar else None,
                "level": a.level,
                "population_all": ar.population if ar and ar.level == "kelurahan" else None,
                "data_year": ar.data_year if ar else None,
                "ik": a.ik,
                "pop_total": a.pop_total,
                "pop_cukup": a.pop_cukup,
                "pop_rawan": a.pop_rawan,
                "pop_late": a.pop_late,
                "pop_terputus": a.pop_terputus,
                "mean_deficit": a.mean_deficit,
                "ik_p5": a.ik_p5,
                "ik_p50": a.ik_p50,
                "ik_p95": a.ik_p95,
            }
        )
    # Penduduk total kecamatan dari data (untuk cek total tabel = total data)
    kec_pop: dict[str, float] = {}
    for ar in areas.values():
        if ar.level == "kelurahan" and ar.population:
            kec_pop[ar.parent_code or ""] = kec_pop.get(ar.parent_code or "", 0) + ar.population
    for o in out:
        if o["level"] == "kecamatan":
            o["population_all"] = kec_pop.get(o["area_code"])
        if o["level"] == "kota":
            o["population_all"] = sum(kec_pop.values())
    return out


@router.get("/runs/{run_id}/areas")
def run_areas(run_id: str, variant: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    return {"items": area_payload(db, r, variant)}


@router.get("/runs/{run_id}/matrix")
def run_matrix(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    if r.kind != "matriks":
        raise ApiError(409, "bukan_matriks", "Run ini bukan matriks skenario.", "Jalankan Matriks 12 dari editor skenario.")
    areas = {x.code: x for x in db.scalars(select(Area).where(Area.dataset_id == r.dataset_id))}
    rows = db.scalars(select(AreaResult).where(AreaResult.run_id == r.id, AreaResult.variant != "", AreaResult.level.in_(["kecamatan", "kota"])))
    table: dict[str, dict] = {}
    for a in rows:
        t = table.setdefault(a.area_code, {"area_code": a.area_code, "name": areas[a.area_code].name if a.area_code in areas else "Total kota", "level": a.level, "values": {}})
        t["values"][a.variant] = {"ik": a.ik, "pop_late": a.pop_late}
    variants = [f"tau{t:g}_ta{a:g}_{m}" for t in MATRIX_DELAYS for a in MATRIX_ARRIVALS for m in MATRIX_MODES]
    return {"variants": [{"key": v, "delay": float(v.split("_")[0][3:]), "arrival": float(v.split("_")[1][2:]), "mode": v.split("_", 2)[2]} for v in variants], "rows": sorted(table.values(), key=lambda x: (x["level"] == "kota", x["name"]))}


@router.get("/runs/{run_id}/cells")
def run_cells(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    return reports.cells_geojson(db, r)


@router.get("/runs/{run_id}/cells/{cell_id}")
def run_cell(run_id: str, cell_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    return cell_detail(db, r, cell_id, public=False)


def cell_detail(db: Session, r: Run, cell_id: int, public: bool) -> dict:
    cr = db.get(CellResult, (r.id, cell_id))
    pc = db.get(PopulationCell, cell_id)
    if not cr or not pc:
        raise ApiError(404, "sel_tidak_ada", "Sel tidak ditemukan pada hasil ini.", "Klik sel berwarna di dalam zona genangan.")
    if public and pc.population < PUBLIC_MIN_CELL_POP:
        raise ApiError(404, "sel_disembunyikan", "Sel berpenduduk kurang dari 10 jiwa disembunyikan pada tampilan publik.", "")
    area = db.scalar(select(Area).where(Area.dataset_id == r.dataset_id, Area.code == pc.area_code))
    kec = db.scalar(select(Area).where(Area.dataset_id == r.dataset_id, Area.code == area.parent_code)) if area and area.parent_code else None
    d, shelters, meta, p = jobs.distances_for_run(db, r)
    b = load_bundle(db, r.dataset_id)
    idx = int(np.searchsorted(b.cells.ids, cell_id))
    route = None
    shelter = None
    if cr.shelter_id is not None and idx < len(b.cells.ids) and b.cells.ids[idx] == cell_id:
        j = int(d.shelter[idx])
        nodes = route_nodes(d.nearest, int(b.cells.node[idx]))
        pts = [b.cells.xy[idx]] + [b.graph.xy[n] for n in nodes] + ([shelters.xy[j]] if j >= 0 else [])
        ll = points_to_lonlat(np.array(pts))
        route = {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": [[round(float(x), 6), round(float(y), 6)] for x, y in ll]}}
        if j >= 0:
            m = meta[j]
            shelter = {"id": m["id"], "name": m["name"], "type": m["type"], "capacity": m["capacity"], "hypothetical": bool(m.get("hypothetical")), "lon": m["lon"], "lat": m["lat"]}
    eff_delay = (r.summary or {}).get("effective_delay_min", r.params["delay_min"])
    return {
        "cell_id": cell_id,
        "kelurahan": area.name if area else pc.area_code,
        "kecamatan": kec.name if kec else None,
        "population": None if public else round(pc.population, 1),
        "lon": pc.lon,
        "lat": pc.lat,
        "cls": cr.cls,
        "dist_m": cr.dist_m,
        "euclid_m": cr.euclid_m,
        "snap_m": float(b.cells.snap[idx]) if idx < len(b.cells.ids) else None,
        "time_min": cr.time_min,
        "margin_min": cr.margin_min,
        "params": {"delay_min": eff_delay, "arrival_min": r.params["arrival_min"], "mode": r.params["mode"], "velocity_ms": p.velocity(), "buffer_min": r.params["buffer_min"]},
        "shelter": shelter,
        "route": route,
    }


@router.get("/runs/{run_id}/shelters")
def run_shelters(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    rows = list(db.scalars(select(ShelterResult).where(ShelterResult.run_id == r.id)))
    pos = {s.id: (s.lon, s.lat) for s in db.scalars(select(Shelter).where(Shelter.dataset_id == r.dataset_id))}
    for e in r.shelters_extra or []:
        pos[e["id"]] = (e["lon"], e["lat"])
    return {
        "items": [
            {
                "shelter_id": x.shelter_id,
                "name": x.name,
                "type": x.type,
                "hypothetical": x.hypothetical,
                "assigned_pop": x.assigned_pop,
                "capacity": x.capacity,
                "load": x.load,
                "flag": x.flag,
                "lon": pos.get(x.shelter_id, (None, None))[0],
                "lat": pos.get(x.shelter_id, (None, None))[1],
            }
            for x in sorted(rows, key=lambda x: -(x.load if x.load is not None else -1))
        ]
    }


def priority_payload(db: Session, r: Run) -> list[dict]:
    areas = {x.code: x for x in db.scalars(select(Area).where(Area.dataset_id == r.dataset_id))}
    out = []
    for it in db.scalars(select(PriorityItem).where(PriorityItem.run_id == r.id).order_by(PriorityItem.rank)):
        a = areas.get(it.area_code)
        kec = areas.get(a.parent_code) if a and a.parent_code else None
        out.append(
            {
                "rank": it.rank,
                "area_code": it.area_code,
                "name": a.name if a else it.area_code,
                "kecamatan": kec.name if kec else None,
                "category": it.category,
                "flags": it.flags,
                "pop_late": it.pop_late,
                "mean_deficit": it.mean_deficit,
                "rationale": it.rationale,
            }
        )
    return out


@router.get("/runs/{run_id}/priorities")
def run_priorities(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    return {"items": priority_payload(db, r)}


class ReportIn(BaseModel):
    format: Literal["pdf", "csv_wilayah", "csv_sel", "geojson"]


REPORT_MEDIA = {"pdf": ("application/pdf", "pdf"), "csv_wilayah": ("text/csv", "csv"), "csv_sel": ("text/csv", "csv"), "geojson": ("application/geo+json", "geojson")}


@router.post("/runs/{run_id}/reports", status_code=201)
def make_report(run_id: str, body: ReportIn, user: User = Depends(require_role("peneliti")), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    rep = Report(run_id=r.id, format=body.format, path="", created_by=user.id)
    db.add(rep)
    db.flush()
    path = _write_report(db, r, rep)
    audit(db, user, "ekspor", f"run:{r.id}", {"format": body.format, "report": rep.id})
    db.commit()
    return {"id": rep.id, "format": rep.format, "url": f"/api/reports/{rep.id}", "size": path.stat().st_size}


def _write_report(db: Session, r: Run, rep: Report) -> Path:
    import json

    ext = REPORT_MEDIA[rep.format][1]
    path = DATA_DIR / "reports" / f"{rep.id}.{ext}"
    if rep.format == "pdf":
        path.write_bytes(reports.export_pdf(db, r))
    elif rep.format == "csv_wilayah":
        path.write_text(reports.export_csv_areas(db, r), encoding="utf-8-sig")
    elif rep.format == "csv_sel":
        path.write_text(reports.export_csv_cells(db, r), encoding="utf-8-sig")
    else:
        path.write_text(json.dumps(reports.cells_geojson(db, r)), encoding="utf-8")
    rep.path = str(path)
    return path


@router.get("/reports/{rep_id}")
def download_report(rep_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep = db.get(Report, rep_id)
    if not rep:
        raise ApiError(404, "laporan_tidak_ada", "Laporan tidak ditemukan.", "Buat ulang laporan dari halaman hasil.")
    run = db.get(Run, rep.run_id)
    if not rep.path or not Path(rep.path).exists():
        # Disk instans gratis tidak permanen: berkas hilang saat server dimulai ulang, jadi buat ulang dari hasil run.
        _write_report(db, run, rep)
        db.commit()
    media, ext = REPORT_MEDIA[rep.format]
    fname = f"sempat_{rep.format}_{run.id[:8]}.{ext}"
    return FileResponse(rep.path, media_type=media, filename=fname)


@router.get("/runs/{run_id}/reports")
def list_reports(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    reps = db.scalars(select(Report).where(Report.run_id == run_id).order_by(Report.created_at.desc()))
    return {"items": [{"id": x.id, "format": x.format, "url": f"/api/reports/{x.id}", "created_at": iso(x.created_at)} for x in reps]}


@router.post("/runs/{run_id}/share", status_code=201)
def share_run(run_id: str, user: User = Depends(require_role("analis")), db: Session = Depends(get_db)):
    r = _run(db, run_id)
    _require_done(r)
    ds = db.get(Dataset, r.dataset_id)
    if not ds.license_open:
        raise ApiError(409, "lisensi_tertutup", "Dataset hasil ini tidak berlisensi terbuka sehingga tidak boleh dipublikasikan.", "Pakai dataset berlisensi terbuka atau minta izin pemilik data.")
    existing = db.scalar(select(ShareLink).where(ShareLink.run_id == r.id, ShareLink.revoked.is_(False)))
    if existing:
        return {"token": existing.token, "url": f"/publik/{existing.token}"}
    link = ShareLink(token=secrets.token_urlsafe(18), run_id=r.id, created_by=user.id)
    db.add(link)
    audit(db, user, "bagikan", f"run:{r.id}")
    db.commit()
    return {"token": link.token, "url": f"/publik/{link.token}"}


@router.delete("/runs/{run_id}/share")
def unshare_run(run_id: str, user: User = Depends(require_role("analis")), db: Session = Depends(get_db)):
    for link in db.scalars(select(ShareLink).where(ShareLink.run_id == run_id, ShareLink.revoked.is_(False))):
        link.revoked = True
    audit(db, user, "cabut_tautan", f"run:{run_id}")
    db.commit()
    return {"ok": True}


# --- Publik (tamu) ------------------------------------------------------------------------


def _public_run(db: Session, token: str) -> Run:
    link = db.get(ShareLink, token)
    if not link or link.revoked:
        raise ApiError(404, "tautan_tidak_berlaku", "Tautan publik tidak ditemukan atau sudah dicabut.", "Minta tautan baru kepada pembuat laporan.")
    return _run(db, link.run_id)


@router.get("/public/{token}")
def public_view(token: str, db: Session = Depends(get_db)):
    r = _public_run(db, token)
    s = db.get(Scenario, r.scenario_id)
    ds = db.get(Dataset, r.dataset_id)
    out = run_out(r)
    for k in ("input_hash",):
        out[k] = r.input_hash
    out.pop("interventions", None)
    return {
        "run": {k: out[k] for k in ("id", "kind", "params", "summary", "finished_at", "engine_version", "seed", "with_interventions", "input_hash", "mc")},
        "scenario_name": s.name if s else "",
        "dataset": {"name": ds.name, "version": ds.version, "source": ds.source, "license": ds.license, "accessed_at": ds.accessed_at, "checksum": ds.checksum},
        "areas": [a for a in area_payload(db, r) if a["level"] in ("kecamatan", "kota")],
        "priorities": [{k: v for k, v in p.items()} for p in priority_payload(db, r)],
        "layers": _layers(db, ds, public=True),
    }


@router.get("/public/{token}/cells")
def public_cells(token: str, db: Session = Depends(get_db)):
    return reports.cells_geojson(db, _public_run(db, token), public=True)


@router.get("/public/{token}/cells/{cell_id}")
def public_cell(token: str, cell_id: int, db: Session = Depends(get_db)):
    return cell_detail(db, _public_run(db, token), cell_id, public=True)


@router.get("/public/{token}/report.pdf")
def public_pdf(token: str, db: Session = Depends(get_db)):
    r = _public_run(db, token)
    return Response(reports.export_pdf(db, r, public=True), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="sempat_ringkasan_{r.id[:8]}.pdf"'})


# --- Admin --------------------------------------------------------------------------------


class UserIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    name: str = Field(min_length=2, max_length=120)
    role: Literal["admin", "analis", "peneliti"]
    password: str = Field(min_length=10, max_length=200)


class UserPatch(BaseModel):
    name: str | None = None
    role: Literal["admin", "analis", "peneliti"] | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=10, max_length=200)


@router.get("/users")
def list_users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    return {"items": [user_out(u) for u in db.scalars(select(User).order_by(User.created_at))]}


@router.post("/users", status_code=201)
def create_user(body: UserIn, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise ApiError(422, "surel_tidak_sah", "Format surel tidak sah.", "Contoh: nama@bpbd.bengkulukota.go.id")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ApiError(409, "surel_terpakai", "Surel ini sudah terdaftar.", "Gunakan surel lain atau aktifkan akun yang ada.")
    u = User(email=email, name=body.name, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit(db, user, "buat_akun", f"user:{u.id}", {"email": email, "role": body.role})
    db.commit()
    return user_out(u)


@router.patch("/users/{user_id}")
def patch_user(user_id: str, body: UserPatch, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise ApiError(404, "akun_tidak_ada", "Akun tidak ditemukan.", "Muat ulang daftar akun.")
    if u.id == user.id and (body.role not in (None, "admin") or body.active is False):
        raise ApiError(409, "akun_sendiri", "Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri.", "Minta admin lain melakukannya.")
    detail = {}
    if body.name is not None:
        u.name = body.name
    if body.role is not None and body.role != u.role:
        detail["peran"] = {"dari": u.role, "ke": body.role}
        u.role = body.role
    if body.active is not None and body.active != u.active:
        detail["aktif"] = body.active
        u.active = body.active
        if not body.active:
            for s in db.scalars(select(SessionToken).where(SessionToken.user_id == u.id)):
                db.delete(s)
    if body.password:
        u.password_hash = hash_password(body.password)
        detail["kata_sandi"] = "diganti"
    audit(db, user, "ubah_peran" if "peran" in detail else "ubah_akun", f"user:{u.id}", detail)
    db.commit()
    return user_out(u)


@router.get("/audit")
def audit_log(action: str | None = None, limit: int = Query(200, le=1000), user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action == action)
    return {
        "items": [
            {"id": a.id, "user_email": a.user_email, "action": a.action, "object_ref": a.object_ref, "detail": a.detail, "at": iso(a.at)}
            for a in db.scalars(q)
        ]
    }


@router.get("/health")
def health():
    return {"status": "ok", "engine_version": ENGINE_VERSION, "time": datetime.now(timezone.utc).isoformat()}
