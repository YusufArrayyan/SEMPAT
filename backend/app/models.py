"""Model data (PRD 6.5). Geometri disimpan sebagai GeoJSON di EPSG:4326."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def uid() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # admin | analis | peneliti
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SessionToken(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(40))
    object_ref: Mapped[str] = mapped_column(String(120))
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draf")  # draf | tervalidasi | terbit | arsip
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(Text, default="")
    license: Mapped[str] = mapped_column(String(120), default="")
    license_open: Mapped[bool] = mapped_column(Boolean, default=False)
    accessed_at: Mapped[str] = mapped_column(String(20), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    files: Mapped[dict] = mapped_column(JSON, default=dict)  # jenis -> {name, size, rows_ok, rows_rejected}
    validation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Area(Base):
    __tablename__ = "areas"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(12))  # kecamatan | kelurahan
    name: Mapped[str] = mapped_column(String(120))
    parent_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    population: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geom: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (Index("ix_area_ds_code", "dataset_id", "code"),)


class Shelter(Base):
    __tablename__ = "shelters"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    type: Mapped[str] = mapped_column(String(20))  # vertikal | dataran_tinggi | tak_diketahui
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="aktif")
    in_inundation: Mapped[bool] = mapped_column(Boolean, default=False)
    flag: Mapped[str] = mapped_column(String(12), default="ok")  # ok | peringatan | ditolak
    note: Mapped[str] = mapped_column(Text, default="")


class RoadSegment(Base):
    __tablename__ = "road_segments"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    coords: Mapped[list] = mapped_column(JSON)
    length_m: Mapped[float] = mapped_column(Float)
    road_class: Mapped[str] = mapped_column(String(40), default="")
    name: Mapped[str] = mapped_column(String(200), default="")


class InundationZone(Base):
    __tablename__ = "inundation_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    geom: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(200), default="")


class Siren(Base):
    __tablename__ = "sirens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="aktif")


class PopulationCell(Base):
    __tablename__ = "population_cells"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    gx: Mapped[int] = mapped_column(Integer)
    gy: Mapped[int] = mapped_column(Integer)
    x: Mapped[float] = mapped_column(Float)  # pusat sel, UTM 48S
    y: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    area_code: Mapped[str] = mapped_column(String(20))
    population: Mapped[float] = mapped_column(Float)
    snapped_node: Mapped[int] = mapped_column(Integer, default=-1)
    snap_dist: Mapped[float] = mapped_column(Float, default=0)
    connected: Mapped[bool] = mapped_column(Boolean, default=True)
    in_zone: Mapped[bool] = mapped_column(Boolean, default=False)


class Scenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    preset: Mapped[str | None] = mapped_column(String(40), nullable=True)
    delay_min: Mapped[float] = mapped_column(Float)
    arrival_min: Mapped[float] = mapped_column(Float)
    mode: Mapped[str] = mapped_column(String(20))
    speed_ms: Mapped[float] = mapped_column(Float)
    night: Mapped[bool] = mapped_column(Boolean, default=False)
    night_factor: Mapped[float] = mapped_column(Float, default=0.75)
    buffer_min: Mapped[float] = mapped_column(Float, default=2)
    detour_threshold: Mapped[float] = mapped_column(Float, default=1.5)
    monte_carlo: Mapped[dict] = mapped_column(JSON, default=dict)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    history: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Intervention(Base):
    __tablename__ = "interventions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))  # tambah_tes | blokir_ruas | kurangi_jeda
    label: Mapped[str] = mapped_column(String(200), default="")
    payload: Mapped[dict] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"))
    kind: Mapped[str] = mapped_column(String(20), default="tunggal")  # tunggal | matriks | monte_carlo
    with_interventions: Mapped[bool] = mapped_column(Boolean, default=False)
    base_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    label: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="antrean")
    progress: Mapped[float] = mapped_column(Float, default=0)
    stage: Mapped[str] = mapped_column(String(120), default="")
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    engine_version: Mapped[str] = mapped_column(String(20), default="")
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    interventions: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    shelters_extra: Mapped[list] = mapped_column(JSON, default=list)  # TES hipotetis
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)


class CellResult(Base):
    __tablename__ = "cell_results"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    cell_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    shelter_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dist_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    euclid_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    time_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    margin_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    cls: Mapped[str] = mapped_column(String(12))


class AreaResult(Base):
    __tablename__ = "area_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    variant: Mapped[str] = mapped_column(String(60), default="")
    area_code: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(12))
    ik: Mapped[float | None] = mapped_column(Float, nullable=True)
    pop_total: Mapped[float] = mapped_column(Float, default=0)
    pop_cukup: Mapped[float] = mapped_column(Float, default=0)
    pop_rawan: Mapped[float] = mapped_column(Float, default=0)
    pop_late: Mapped[float] = mapped_column(Float, default=0)
    pop_terputus: Mapped[float] = mapped_column(Float, default=0)
    mean_deficit: Mapped[float] = mapped_column(Float, default=0)
    ik_p5: Mapped[float | None] = mapped_column(Float, nullable=True)
    ik_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    ik_p95: Mapped[float | None] = mapped_column(Float, nullable=True)


class ShelterResult(Base):
    __tablename__ = "shelter_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    shelter_id: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20))
    hypothetical: Mapped[bool] = mapped_column(Boolean, default=False)
    assigned_pop: Mapped[float] = mapped_column(Float, default=0)
    capacity: Mapped[float | None] = mapped_column(Float, nullable=True)
    load: Mapped[float | None] = mapped_column(Float, nullable=True)
    flag: Mapped[str] = mapped_column(String(12), default="ok")


class PriorityItem(Base):
    __tablename__ = "priority_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    area_code: Mapped[str] = mapped_column(String(20))
    rank: Mapped[int] = mapped_column(Integer)
    category: Mapped[str] = mapped_column(String(30))
    flags: Mapped[list] = mapped_column(JSON, default=list)
    pop_late: Mapped[float] = mapped_column(Float)
    mean_deficit: Mapped[float] = mapped_column(Float)
    rationale: Mapped[list] = mapped_column(JSON, default=list)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(400))
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ShareLink(Base):
    __tablename__ = "share_links"
    token: Mapped[str] = mapped_column(String(48), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
