"""Inisialisasi basis data, akun awal, dan data contoh sintetis."""

from __future__ import annotations

import logging
import os

from sqlalchemy import select, text

from .config import SAMPLE_DIR
from .datasets import checksum, store_parsed, validate_and_grid
from .db import Base, SessionLocal, engine
from .importers import PARSERS
from .models import Dataset, Scenario, User, now
from .security import audit, hash_password

log = logging.getLogger("sempat.bootstrap")

# Akun awal pengembangan lokal. Ganti lewat variabel lingkungan untuk penyebaran.
SEED_USERS = [
    ("admin@sempat.local", "Admin Sempat", "admin", os.getenv("SEMPAT_ADMIN_PASSWORD", "sempat-admin-2026")),
    ("analis@sempat.local", "Analis BPBD", "analis", os.getenv("SEMPAT_ANALIS_PASSWORD", "sempat-analis-2026")),
    ("peneliti@sempat.local", "Peneliti Bappeda", "peneliti", os.getenv("SEMPAT_PENELITI_PASSWORD", "sempat-peneliti-2026")),
]

SAMPLE_FILES = [
    ("wilayah", "wilayah.geojson"),
    ("penduduk", "penduduk.csv"),
    ("jalan", "jalan.geojson"),
    ("genangan", "genangan.geojson"),
    ("tes", "tes.csv"),
    ("sirene", "sirene.geojson"),
]


def init_db() -> None:
    Base.metadata.create_all(engine)
    if engine.dialect.name == "sqlite":
        with engine.begin() as c:
            # Log audit hanya dapat ditambah (FR-22).
            c.execute(text("CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'log audit hanya dapat ditambah'); END;"))
            c.execute(text("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'log audit hanya dapat ditambah'); END;"))
    elif engine.dialect.name == "postgresql":
        with engine.begin() as c:
            c.execute(
                text(
                    "CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'log audit hanya dapat ditambah'; END; $$ LANGUAGE plpgsql;"
                )
            )
            c.execute(text("DROP TRIGGER IF EXISTS audit_append_only ON audit_log;"))
            c.execute(text("CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_append_only();"))


def seed(with_sample: bool = True) -> None:
    db = SessionLocal()
    try:
        if not db.scalar(select(User)):
            for email, name, role, pw in SEED_USERS:
                db.add(User(email=email, name=name, role=role, password_hash=hash_password(pw)))
            db.commit()
            log.info("akun awal dibuat")
        if with_sample and not db.scalar(select(Dataset)):
            seed_sample(db)
    finally:
        db.close()


def seed_sample(db) -> Dataset:
    from .sample import generate

    if not (SAMPLE_DIR / "jalan.geojson").exists():
        generate(SAMPLE_DIR)
    admin = db.scalar(select(User).where(User.role == "admin"))
    ds = Dataset(
        name="Data contoh Kota Bengkulu (sintetis)",
        version=1,
        source="Data sintetis buatan generator Sempat (app/sample.py, benih 2026). Bukan data resmi BPBD, BPS, atau InaRISK.",
        license="CC BY 4.0 (data contoh)",
        license_open=True,
        accessed_at=now().date().isoformat(),
        notes="Untuk mencoba alur aplikasi. Ganti dengan data resmi sebelum dipakai dalam kajian.",
        created_by=admin.id if admin else None,
    )
    db.add(ds)
    db.flush()
    files = {}
    for kind, fname in SAMPLE_FILES:
        data = (SAMPLE_DIR / fname).read_bytes()
        parsed = PARSERS[kind](data, fname)
        store_parsed(db, ds, kind, parsed)
        db.flush()
        files[kind] = {
            "name": fname,
            "size": len(data),
            "rows_ok": len(parsed.rows),
            "rows_rejected": len(parsed.rejected),
            "rejected": parsed.rejected[:200],
            "warnings": parsed.warnings[:50],
            "crs": parsed.crs,
            "uploaded_at": now().isoformat(),
        }
    ds.files = files
    validate_and_grid(db, ds)
    if ds.status == "tervalidasi":
        ds.checksum = checksum(db, ds)
        ds.status = "terbit"
        ds.published_at = now()
    audit(db, admin, "terbit", f"dataset:{ds.id}", {"catatan": "data contoh sintetis"})
    db.commit()
    log.info("data contoh dimuat: %s", ds.stats)
    if ds.status == "terbit" and admin:
        from .api import PRESETS

        for key in ("esai_2026", "fachri_2022"):
            p = PRESETS[key]
            db.add(
                Scenario(
                    dataset_id=ds.id,
                    created_by=admin.id,
                    name=f"{p['label']} — jalan kaki",
                    description=p["description"],
                    preset=key,
                    monte_carlo={"n": 1000, "seed": 20261015, "delay": [0.0, 5.0, 15.0], "arrival": [10.0, 20.0, 35.0], "speed": [0.75, 1.09, 1.4]},
                    history=[{"at": now().isoformat(), "by": admin.name, "change": "dibuat dari preset"}],
                    **{k: p[k] for k in ("delay_min", "arrival_min", "mode", "speed_ms", "night", "night_factor", "buffer_min", "detour_threshold")},
                )
            )
        db.commit()
    return ds
