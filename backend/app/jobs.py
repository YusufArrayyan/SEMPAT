"""Pekerja hitung asinkron (FR-09): antrean -> berjalan -> selesai | gagal | dibatalkan.

Versi ini memakai kumpulan utas dalam proses agar dapat berjalan tanpa Redis. Antarmuka
pekerja (submit, cancel) sengaja kecil sehingga dapat diganti RQ tanpa mengubah API.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from sqlalchemy import delete

from .config import WORKERS
from .datasets import Bundle, load_bundle, shelters_from
from .db import SessionLocal
from .engine import ENGINE_VERSION
from .engine.compute import (
    CLASS_NAMES,
    TERLAMBAT,
    TERPUTUS,
    Distances,
    Params,
    Shelters,
    aggregate,
    cell_distances,
    classify,
    matrix_variants,
    monte_carlo,
    priorities,
    shelter_loads,
)
from .models import AreaResult, CellResult, Dataset, PriorityItem, Run, ShelterResult, now

log = logging.getLogger("sempat.jobs")
_executor = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="sempat-hitung")
_cancel: dict[str, threading.Event] = {}


class RunFailure(Exception):
    def __init__(self, message: str, hint: str):
        super().__init__(message)
        self.message = message
        self.hint = hint


def input_hash(params: dict, interventions: list, dataset_checksum: str, kind: str, seed: int | None, mc: dict | None) -> str:
    payload = {
        "params": params,
        "interventions": [{k: v for k, v in i.items() if k in ("type", "payload")} for i in interventions],
        "dataset": dataset_checksum,
        "engine": ENGINE_VERSION,
        "kind": kind,
        "seed": seed,
        "mc": mc if kind == "monte_carlo" else None,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def params_of(d: dict) -> Params:
    fields = Params.__dataclass_fields__
    return Params(**{k: v for k, v in d.items() if k in fields})


def submit(run_id: str) -> None:
    _cancel[run_id] = threading.Event()
    _executor.submit(_execute, run_id)


def cancel(run_id: str) -> None:
    ev = _cancel.get(run_id)
    if ev:
        ev.set()


def apply_interventions(b: Bundle, p: Params, interventions: list[dict]):
    blocked: set[str] = set()
    extra: list[dict] = []
    for iv in interventions:
        t, pl = iv["type"], iv["payload"]
        if t == "tambah_tes":
            extra.append(
                {
                    "id": f"hipotetis-{iv['id'][:8]}",
                    "name": pl.get("name") or "TES hipotetis",
                    "lon": float(pl["lon"]),
                    "lat": float(pl["lat"]),
                    "type": pl.get("type", "vertikal"),
                    "capacity": pl.get("capacity"),
                    "flag": "ok",
                    "hypothetical": True,
                }
            )
        elif t == "blokir_ruas":
            blocked.update(s for s in pl.get("segment_ids", []) if s in b.segment_ids)
        elif t == "kurangi_jeda":
            p.delay_min = max(0.0, p.delay_min - float(pl.get("minus_min", 0)))
    if extra:
        shelters, meta = shelters_from(b.graph, b.shelter_meta + extra)
    else:
        shelters, meta = b.shelters, b.shelter_meta
    return p, blocked, shelters, meta, extra


# Cache jarak per Run untuk rincian sel dan rute.
_dist_cache: OrderedDict[str, tuple[Distances, Shelters, list[dict], Params]] = OrderedDict()
_dist_lock = threading.Lock()


def distances_for_run(db, run: Run):
    with _dist_lock:
        if run.id in _dist_cache:
            _dist_cache.move_to_end(run.id)
            return _dist_cache[run.id]
    b = load_bundle(db, run.dataset_id)
    p = params_of(run.params)
    p, blocked, shelters, meta, _ = apply_interventions(b, p, run.interventions if run.with_interventions else [])
    d = cell_distances(b.graph, b.cells, shelters, blocked)
    val = (d, shelters, meta, p)
    with _dist_lock:
        _dist_cache[run.id] = val
        while len(_dist_cache) > 24:
            _dist_cache.popitem(last=False)
    return val


def _execute(run_id: str) -> None:
    db = SessionLocal()
    ev = _cancel.get(run_id) or threading.Event()
    try:
        run = db.get(Run, run_id)
        if run is None or run.status != "antrean":
            return
        run.status = "berjalan"
        run.started_at = now()
        run.stage = "Menyiapkan data"
        db.commit()
        t0 = time.perf_counter()

        def stage(msg: str, prog: float):
            if ev.is_set():
                raise InterruptedError
            run.stage = msg
            run.progress = prog
            db.commit()

        ds = db.get(Dataset, run.dataset_id)
        if ds is None or ds.status != "terbit":
            raise RunFailure("Dataset skenario ini belum terbit atau sudah tidak tersedia.", "Terbitkan dataset di halaman Data, lalu jalankan ulang.")
        b = load_bundle(db, ds.id)
        if len(b.cells.ids) == 0:
            raise RunFailure("Tidak ada sel permukiman di zona genangan.", "Periksa zona genangan dan batas wilayah pada laporan validasi.")
        base_p = params_of(run.params)
        errs = base_p.validate()
        if errs:
            raise RunFailure(" ".join(errs), "Perbaiki parameter di editor skenario.")
        p, blocked, shelters, meta, extra = apply_interventions(b, params_of(run.params), run.interventions if run.with_interventions else [])
        if len(shelters.ids) == 0:
            raise RunFailure("Tidak ada TES sah untuk dihitung.", "Periksa laporan validasi TES pada dataset.")
        run.shelters_extra = extra

        stage("Menghitung jarak jaringan (Dijkstra multi-sumber)", 0.1)
        d = cell_distances(b.graph, b.cells, shelters, blocked)
        with _dist_lock:
            _dist_cache[run.id] = (d, shelters, meta, p)

        stage("Menghitung sisa waktu dan kelas", 0.35)
        t, m, cls = classify(d.dist, p)
        pop, kel = b.cells.pop, b.cells.kel
        agg = aggregate(pop, kel, cls, m, b.kel_to_kec)
        loads = shelter_loads(pop, d, shelters)

        db.execute(delete(CellResult).where(CellResult.run_id == run.id))
        db.execute(delete(AreaResult).where(AreaResult.run_id == run.id))
        db.execute(delete(ShelterResult).where(ShelterResult.run_id == run.id))
        db.execute(delete(PriorityItem).where(PriorityItem.run_id == run.id))

        cell_rows = []
        for i in range(len(b.cells.ids)):
            fin = bool(np.isfinite(d.dist[i]))
            cell_rows.append(
                {
                    "run_id": run.id,
                    "cell_id": int(b.cells.ids[i]),
                    "shelter_id": str(shelters.ids[d.shelter[i]]) if d.shelter[i] >= 0 else None,
                    "dist_m": float(d.dist[i]) if fin else None,
                    "euclid_m": float(d.euclid[i]) if fin else None,
                    "time_min": float(t[i]) if fin else None,
                    "margin_min": float(m[i]) if fin else None,
                    "cls": CLASS_NAMES[cls[i]],
                }
            )
        db.execute(CellResult.__table__.insert(), cell_rows)

        mc_stats = {}
        if run.kind == "monte_carlo":
            mc = run.params.get("_mc") or {}
            tri = {"delay": mc["delay"], "arrival": mc["arrival"], "speed": mc["speed"]}

            def prog(f):
                run.progress = 0.4 + 0.5 * f
                db.commit()

            stage(f"Monte Carlo: {mc['n']} undian (benih {run.seed})", 0.4)
            mc_stats = monte_carlo(d.dist, pop, kel, b.kel_to_kec, p, tri, int(mc["n"]), int(run.seed), cancel=ev.is_set, progress=prog)

        area_rows = []
        for code, a in agg.items():
            area_rows.append({"run_id": run.id, "variant": "", **a, **mc_stats.get(code, {})})

        if run.kind == "matriks":
            variants = matrix_variants(p, run.params.get("_speeds"))
            for vi, (label, q) in enumerate(variants):
                stage(f"Matriks: varian {vi + 1} dari {len(variants)}", 0.4 + 0.5 * vi / len(variants))
                _, mq, cq = classify(d.dist, q)
                for code, a in aggregate(pop, kel, cq, mq, b.kel_to_kec).items():
                    area_rows.append({"run_id": run.id, "variant": label, **a})
        db.execute(AreaResult.__table__.insert(), area_rows)

        stage("Menyusun beban TES dan daftar prioritas", 0.92)
        for j, l in enumerate(loads):
            mt = meta[j]
            db.add(
                ShelterResult(
                    run_id=run.id,
                    shelter_id=l["shelter_id"],
                    name=mt["name"],
                    type=mt["type"],
                    hypothetical=bool(mt.get("hypothetical")),
                    assigned_pop=l["assigned_pop"],
                    capacity=l["capacity"],
                    load=l["load"],
                    flag=mt.get("flag", "ok"),
                )
            )
        for it in priorities(pop, kel, d, p, loads, shelters):
            db.add(PriorityItem(run_id=run.id, **it))

        total = agg["__total__"]
        counts = {CLASS_NAMES[c]: int((cls == c).sum()) for c in range(4)}
        run.summary = {
            "ik": total["ik"],
            "pop_total": total["pop_total"],
            "pop_cukup": total["pop_cukup"],
            "pop_rawan": total["pop_rawan"],
            "pop_late": total["pop_late"],
            "pop_terputus": total["pop_terputus"],
            "mean_deficit": total["mean_deficit"],
            "cells": len(b.cells.ids),
            "cell_counts": counts,
            "shelters": len(shelters.ids),
            "shelters_overloaded": int(sum(1 for l in loads if l["load"] is not None and l["load"] > 1)),
            "shelters_unknown_capacity": int(sum(1 for l in loads if l["load"] is None)),
            "blocked_segments": sorted(blocked),
            "effective_delay_min": p.delay_min,
            "velocity_ms": p.velocity(),
            "late_cells": int((cls == TERLAMBAT).sum()),
            "disconnected_cells": int((cls == TERPUTUS).sum()),
            "mc": mc_stats.get("__total__"),
        }
        run.status = "selesai"
        run.progress = 1.0
        run.stage = "Selesai"
        run.finished_at = now()
        run.duration_s = time.perf_counter() - t0
        db.commit()
        log.info("run selesai", extra={"run_id": run.id, "kind": run.kind, "durasi_s": run.duration_s, "sel": len(b.cells.ids)})
    except InterruptedError:
        db.rollback()
        _finish(db, run_id, "dibatalkan", None)
    except RunFailure as e:
        db.rollback()
        _finish(db, run_id, "gagal", {"message": e.message, "hint": e.hint})
    except Exception as e:  # noqa: BLE001
        log.exception("run gagal")
        db.rollback()
        _finish(db, run_id, "gagal", {"message": f"Galat tak terduga pada mesin hitung: {e}", "hint": "Jalankan ulang. Bila berulang, kirim ID Run ini kepada Admin."})
    finally:
        _cancel.pop(run_id, None)
        db.close()


def _finish(db, run_id: str, status: str, error: dict | None) -> None:
    run = db.get(Run, run_id)
    if run is None:
        return
    run.status = status
    run.error = error
    run.stage = {"dibatalkan": "Dibatalkan pengguna", "gagal": "Gagal"}.get(status, status)
    run.finished_at = now()
    db.commit()
