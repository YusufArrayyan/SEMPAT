"""Penyimpanan impor, validasi kualitas (FR-05), kisi 100 m (FR-06), terbit (FR-07)."""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .engine.compute import MAX_SNAP_M, Cells, Shelters
from .engine.geo import geom_to_utm, points_to_lonlat, to_utm
from .engine.graph import RoadGraph, build_graph
from .importers import REQUIRED_KINDS, Parsed
from .models import Area, Dataset, InundationZone, PopulationCell, RoadSegment, Shelter, Siren, now

CELL_SIZE = 100.0


def store_parsed(db: Session, ds: Dataset, kind: str, parsed: Parsed) -> None:
    """Ganti isi satu jenis berkas pada dataset draf."""
    if kind == "tes":
        db.execute(delete(Shelter).where(Shelter.dataset_id == ds.id))
        for r in parsed.rows:
            db.add(Shelter(dataset_id=ds.id, **r))
    elif kind == "jalan":
        db.execute(delete(RoadSegment).where(RoadSegment.dataset_id == ds.id))
        for r in parsed.rows:
            xs, ys = to_utm(np.array([c[0] for c in r["coords"]]), np.array([c[1] for c in r["coords"]]))
            length = float(np.hypot(np.diff(xs), np.diff(ys)).sum())
            db.add(RoadSegment(id=f"{ds.id[:8]}:{r['id']}"[:40], dataset_id=ds.id, coords=r["coords"], length_m=length, road_class=r["road_class"], name=r["name"]))
    elif kind == "wilayah":
        old_pop = {a.code: (a.population, a.data_year) for a in db.scalars(select(Area).where(Area.dataset_id == ds.id))}
        db.execute(delete(Area).where(Area.dataset_id == ds.id))
        for r in parsed.rows:
            pop, year = old_pop.get(r["code"], (None, None))
            db.add(Area(dataset_id=ds.id, population=pop, data_year=year, **r))
    elif kind == "penduduk":
        areas = {a.code: a for a in db.scalars(select(Area).where(Area.dataset_id == ds.id, Area.level == "kelurahan"))}
        unknown = []
        for a in areas.values():
            a.population = None
        for r in parsed.rows:
            a = areas.get(r["code"])
            if a is None:
                unknown.append(r["code"])
                continue
            a.population = r["population"]
            a.data_year = r["year"]
        if unknown:
            parsed.warnings.append(f"{len(unknown)} kode wilayah tidak dikenal: {', '.join(unknown[:10])}" + (" …" if len(unknown) > 10 else ""))
            for c in unknown:
                parsed.rejected.append({"row": c, "reason": f"Kode wilayah {c} tidak ada pada batas kelurahan."})
    elif kind == "genangan":
        db.execute(delete(InundationZone).where(InundationZone.dataset_id == ds.id))
        for r in parsed.rows:
            db.add(InundationZone(dataset_id=ds.id, **r))
    elif kind == "sirene":
        db.execute(delete(Siren).where(Siren.dataset_id == ds.id))
        for r in parsed.rows:
            db.add(Siren(dataset_id=ds.id, **r))
    ds.status = "draf"
    ds.validation = None


def _graph_from_rows(rows) -> RoadGraph:
    segs = []
    for r in sorted(rows, key=lambda s: s.id):
        lon = np.array([c[0] for c in r.coords])
        lat = np.array([c[1] for c in r.coords])
        xs, ys = to_utm(lon, lat)
        segs.append((r.id, list(zip(xs.tolist(), ys.tolist()))))
    return build_graph(segs)


def validate_and_grid(db: Session, ds: Dataset) -> dict:
    """Bangun laporan validasi dan kisi sel. Status menjadi 'tervalidasi' bila bebas galat kritis."""
    errors: list[dict] = []
    warnings: list[dict] = []
    files = ds.files or {}
    for k in REQUIRED_KINDS:
        if k not in files:
            errors.append({"check": "berkas", "message": f"Berkas {k} belum diunggah.", "hint": "Unggah berkas ini di bagian Impor berkas."})
    crs_report = {k: v.get("crs", "-") for k, v in files.items()}

    areas = list(db.scalars(select(Area).where(Area.dataset_id == ds.id)))
    kel = [a for a in areas if a.level == "kelurahan"]
    kec = {a.code: a for a in areas if a.level == "kecamatan"}
    shelters = list(db.scalars(select(Shelter).where(Shelter.dataset_id == ds.id)))
    roads = list(db.scalars(select(RoadSegment).where(RoadSegment.dataset_id == ds.id)))
    zones = list(db.scalars(select(InundationZone).where(InundationZone.dataset_id == ds.id)))

    # Penduduk nol, negatif, atau kosong.
    pop_issues = []
    for a in kel:
        if a.population is None:
            pop_issues.append({"code": a.code, "name": a.name, "issue": "tidak ada data penduduk"})
        elif a.population <= 0:
            pop_issues.append({"code": a.code, "name": a.name, "issue": "penduduk nol atau negatif" if a.population <= 0 else ""})
    for a in kel:
        if a.parent_code and a.parent_code not in kec:
            warnings.append({"check": "wilayah", "message": f"Kelurahan {a.name} merujuk kecamatan {a.parent_code} yang tidak ada.", "hint": "Tambahkan poligon kecamatan atau perbaiki kode_induk."})
    neg = [p for p in pop_issues if p["issue"] == "penduduk nol atau negatif"]
    if neg:
        errors.append({"check": "penduduk", "message": f"{len(neg)} kelurahan berpenduduk nol atau negatif.", "hint": "Perbaiki angka pada CSV penduduk lalu unggah ulang."})
    missing = [p for p in pop_issues if p["issue"] == "tidak ada data penduduk"]
    if missing:
        warnings.append({"check": "penduduk", "message": f"{len(missing)} kelurahan tidak memiliki data penduduk dan tidak dihitung.", "hint": "Lengkapi CSV penduduk dengan kode kelurahan tersebut."})

    # Jaringan jalan.
    graph = _graph_from_rows(roads) if roads else None
    road_stats = {"nodes": 0, "edges": 0, "components": 0, "largest_component_share": 0.0}
    if graph is not None and graph.n_nodes:
        ncomp, labels = graph.components()
        counts = np.bincount(labels)
        road_stats = {
            "nodes": graph.n_nodes,
            "edges": graph.n_edges,
            "components": int(ncomp),
            "largest_component_share": float(counts.max() / graph.n_nodes),
        }
        if ncomp > 1:
            warnings.append(
                {
                    "check": "jalan",
                    "message": f"Jaringan jalan memiliki {ncomp} komponen terpisah; komponen terbesar memuat {road_stats['largest_component_share']:.0%} simpul.",
                    "hint": "Sel pada komponen kecil yang tidak memiliki TES akan berkelas Terputus. Periksa sambungan ruas.",
                }
            )

    # Zona genangan dan TES.
    zone_utm = unary_union([geom_to_utm(shape(z.geom)) for z in zones]) if zones else None
    shelter_report = []
    for s in shelters:
        x, y = to_utm(s.lon, s.lat)
        inside = bool(zone_utm is not None and zone_utm.contains(Point(x, y)))
        s.in_inundation = inside
        s.flag, s.note = "ok", ""
        if inside and s.type == "dataran_tinggi":
            s.flag = "ditolak"
            s.note = "TES dataran tinggi berada di dalam zona genangan: diduga galat koordinat."
        elif inside and s.type == "tak_diketahui":
            s.flag = "peringatan"
            s.note = "Tipe belum diketahui di dalam zona genangan; tetap dihitung dengan tanda sampai tipe diisi."
        elif s.status != "aktif":
            s.flag = "peringatan"
            s.note = f"Status {s.status}; tidak dihitung."
        if s.capacity is None and s.flag == "ok":
            s.note = "Kapasitas belum diketahui."
        if s.flag != "ok" or s.capacity is None:
            shelter_report.append({"id": s.id, "name": s.name, "type": s.type, "flag": s.flag, "note": s.note, "in_zone": inside})
    rejected = [s for s in shelters if s.flag == "ditolak"]
    if rejected:
        errors_or_warn = {"check": "tes", "message": f"{len(rejected)} TES dataran tinggi berada di zona genangan dan ditolak.", "hint": "Periksa koordinat TES tersebut; TES lain tetap dihitung."}
        warnings.append(errors_or_warn)
    unknown_in_zone = [s for s in shelters if s.flag == "peringatan" and s.type == "tak_diketahui"]
    if unknown_in_zone:
        warnings.append({"check": "tes", "message": f"{len(unknown_in_zone)} TES bertipe tak_diketahui di zona genangan.", "hint": "Isi tipe TES (vertikal atau dataran_tinggi) agar tanda hilang."})
    no_cap = [s for s in shelters if s.capacity is None]
    if no_cap:
        warnings.append({"check": "tes", "message": f"{len(no_cap)} TES tanpa kapasitas; beban ditandai 'kapasitas belum diketahui'.", "hint": "Minta data kapasitas ke BPBD."})
    valid_shelters = [s for s in shelters if s.flag != "ditolak" and s.status == "aktif"]
    if shelters and not valid_shelters:
        errors.append({"check": "tes", "message": "Tidak ada TES sah untuk dihitung.", "hint": "Perbaiki tipe atau koordinat TES."})

    # Kisi 100 m.
    db.execute(delete(PopulationCell).where(PopulationCell.dataset_id == ds.id))
    grid_stats = {"cells": 0, "cells_in_zone": 0, "cells_disconnected": 0, "pop_cells": 0.0, "pop_areas": 0.0, "diff_pct": 0.0}
    if kel and not errors:
        grid_stats = _build_grid(db, ds, kel, zone_utm, graph)
        if grid_stats["diff_pct"] > 0.5:
            errors.append({"check": "kisi", "message": f"Selisih penduduk sel terhadap kelurahan {grid_stats['diff_pct']:.2f}% (batas 0,5%).", "hint": "Periksa poligon kelurahan yang tumpang tindih."})
        if grid_stats["cells_disconnected"]:
            warnings.append(
                {
                    "check": "kisi",
                    "message": f"{grid_stats['cells_disconnected']} sel di zona genangan berjarak > 200 m dari jalan dan ditandai Terputus.",
                    "hint": "Tambahkan ruas jalan atau gang di sekitar sel tersebut.",
                }
            )
        if grid_stats["cells_in_zone"] == 0:
            errors.append({"check": "kisi", "message": "Tidak ada sel permukiman di dalam zona genangan.", "hint": "Periksa apakah zona genangan dan batas wilayah berada di lokasi yang sama."})

    report = {
        "generated_at": now().isoformat(),
        "crs": crs_report,
        "errors": errors,
        "warnings": warnings,
        "population_issues": pop_issues,
        "shelters": shelter_report,
        "road": road_stats,
        "grid": grid_stats,
        "counts": {
            "kecamatan": len(kec),
            "kelurahan": len(kel),
            "tes": len(shelters),
            "tes_sah": len(valid_shelters),
            "ruas": len(roads),
            "zona": len(zones),
            "sirene": db.query(Siren).filter(Siren.dataset_id == ds.id).count(),
        },
    }
    ds.validation = report
    ds.stats = {**road_stats, **grid_stats, **report["counts"]}
    ds.status = "tervalidasi" if not errors else "draf"
    return report


def _build_grid(db: Session, ds: Dataset, kel: list[Area], zone_utm, graph: RoadGraph | None) -> dict:
    polys = [(a, geom_to_utm(shape(a.geom))) for a in kel if a.geom and a.population and a.population > 0]
    if not polys:
        return {"cells": 0, "cells_in_zone": 0, "cells_disconnected": 0, "pop_cells": 0.0, "pop_areas": 0.0, "diff_pct": 0.0}
    minx = min(p.bounds[0] for _, p in polys)
    miny = min(p.bounds[1] for _, p in polys)
    ox = np.floor(minx / CELL_SIZE) * CELL_SIZE
    oy = np.floor(miny / CELL_SIZE) * CELL_SIZE
    taken: set[tuple[int, int]] = set()
    recs = []  # (gx, gy, x, y, code, pop)
    pop_areas = 0.0
    for a, poly in sorted(polys, key=lambda t: t[0].code):
        bx0, by0, bx1, by1 = poly.bounds
        gxs = np.arange(int(np.floor((bx0 - ox) / CELL_SIZE)), int(np.ceil((bx1 - ox) / CELL_SIZE)) + 1)
        gys = np.arange(int(np.floor((by0 - oy) / CELL_SIZE)), int(np.ceil((by1 - oy) / CELL_SIZE)) + 1)
        GX, GY = np.meshgrid(gxs, gys)
        cx = ox + (GX.ravel() + 0.5) * CELL_SIZE
        cy = oy + (GY.ravel() + 0.5) * CELL_SIZE
        inside = shapely.contains_xy(poly, cx, cy)
        cand = [(int(gx), int(gy), float(x), float(y)) for gx, gy, x, y, ok in zip(GX.ravel(), GY.ravel(), cx, cy, inside) if ok and (int(gx), int(gy)) not in taken]
        if not cand:
            rp = poly.representative_point()
            gx = int((rp.x - ox) // CELL_SIZE)
            gy = int((rp.y - oy) // CELL_SIZE)
            cand = [(gx, gy, float(rp.x), float(rp.y))]
        share = float(a.population) / len(cand)
        pop_areas += float(a.population)
        for gx, gy, x, y in cand:
            taken.add((gx, gy))
            recs.append((gx, gy, x, y, a.code, share))
    xy = np.array([[r[2], r[3]] for r in recs])
    in_zone = shapely.contains_xy(zone_utm, xy[:, 0], xy[:, 1]) if zone_utm is not None else np.zeros(len(xy), dtype=bool)
    if graph is not None and graph.n_nodes:
        node, snap = graph.snap(xy)
    else:
        node, snap = np.full(len(xy), -1), np.full(len(xy), np.inf)
    ll = points_to_lonlat(xy)
    rows = []
    for i, r in enumerate(recs):
        rows.append(
            {
                "dataset_id": ds.id,
                "gx": r[0],
                "gy": r[1],
                "x": r[2],
                "y": r[3],
                "lon": float(ll[i, 0]),
                "lat": float(ll[i, 1]),
                "area_code": r[4],
                "population": r[5],
                "snapped_node": int(node[i]),
                "snap_dist": float(snap[i]) if np.isfinite(snap[i]) else 1e9,
                "connected": bool(snap[i] <= MAX_SNAP_M),
                "in_zone": bool(in_zone[i]),
            }
        )
    db.execute(PopulationCell.__table__.insert(), rows)
    pop_cells = float(sum(r[5] for r in recs))
    return {
        "cells": len(rows),
        "cells_in_zone": int(in_zone.sum()),
        "cells_disconnected": int(sum(1 for r in rows if r["in_zone"] and not r["connected"])),
        "pop_cells": pop_cells,
        "pop_areas": pop_areas,
        "pop_in_zone": float(sum(r["population"] for r in rows if r["in_zone"])),
        "diff_pct": abs(pop_cells - pop_areas) / pop_areas * 100 if pop_areas else 0.0,
        "origin": [float(ox), float(oy)],
        "cell_size": CELL_SIZE,
    }


def checksum(db: Session, ds: Dataset) -> str:
    h = hashlib.sha256()

    def feed(obj):
        h.update(json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode())

    for a in db.scalars(select(Area).where(Area.dataset_id == ds.id).order_by(Area.code)):
        feed([a.code, a.level, a.name, a.parent_code, a.population, a.geom])
    for s in db.scalars(select(Shelter).where(Shelter.dataset_id == ds.id).order_by(Shelter.name, Shelter.lon, Shelter.lat)):
        feed([s.name, s.lon, s.lat, s.type, s.capacity, s.status])
    for r in db.scalars(select(RoadSegment).where(RoadSegment.dataset_id == ds.id).order_by(RoadSegment.id)):
        feed([r.id.split(":", 1)[-1], r.coords])
    for z in db.scalars(select(InundationZone).where(InundationZone.dataset_id == ds.id).order_by(InundationZone.id)):
        feed(z.geom)
    for s in db.scalars(select(Siren).where(Siren.dataset_id == ds.id).order_by(Siren.id)):
        feed([s.lon, s.lat, s.status])
    return h.hexdigest()


def clone_dataset(db: Session, src: Dataset, user_id: str | None) -> Dataset:
    """Koreksi atas dataset terbit membuat versi baru (draf)."""
    latest = db.query(Dataset).filter(Dataset.name == src.name).order_by(Dataset.version.desc()).first()
    new = Dataset(
        name=src.name,
        version=(latest.version if latest else src.version) + 1,
        status="draf",
        source=src.source,
        license=src.license,
        license_open=src.license_open,
        accessed_at=src.accessed_at,
        notes=src.notes,
        files=dict(src.files or {}),
        parent_id=src.id,
        created_by=user_id,
    )
    db.add(new)
    db.flush()
    pfx = new.id[:8]
    for a in db.scalars(select(Area).where(Area.dataset_id == src.id)):
        db.add(Area(dataset_id=new.id, code=a.code, level=a.level, name=a.name, parent_code=a.parent_code, population=a.population, data_year=a.data_year, geom=a.geom))
    for s in db.scalars(select(Shelter).where(Shelter.dataset_id == src.id)):
        db.add(Shelter(dataset_id=new.id, name=s.name, lon=s.lon, lat=s.lat, type=s.type, capacity=s.capacity, status=s.status))
    rows = [
        {"id": f"{pfx}:{r.id.split(':', 1)[-1]}"[:40], "dataset_id": new.id, "coords": r.coords, "length_m": r.length_m, "road_class": r.road_class, "name": r.name}
        for r in db.scalars(select(RoadSegment).where(RoadSegment.dataset_id == src.id))
    ]
    if rows:
        db.execute(RoadSegment.__table__.insert(), rows)
    for z in db.scalars(select(InundationZone).where(InundationZone.dataset_id == src.id)):
        db.add(InundationZone(dataset_id=new.id, geom=z.geom, source=z.source))
    for s in db.scalars(select(Siren).where(Siren.dataset_id == src.id)):
        db.add(Siren(dataset_id=new.id, name=s.name, lon=s.lon, lat=s.lat, status=s.status))
    return new


# --- Bundel siap hitung (cache; dataset terbit tidak berubah) ---------------------------


@dataclass
class Bundle:
    dataset_id: str
    graph: RoadGraph
    cells: Cells
    shelters: Shelters
    shelter_meta: list[dict]
    kel_to_kec: dict[str, str]
    area_names: dict[str, str]
    segment_ids: set[str]


_cache: dict[str, Bundle] = {}
_lock = threading.Lock()


def load_bundle(db: Session, dataset_id: str) -> Bundle:
    with _lock:
        if dataset_id in _cache:
            return _cache[dataset_id]
    roads = list(db.scalars(select(RoadSegment).where(RoadSegment.dataset_id == dataset_id)))
    graph = _graph_from_rows(roads)
    rows = list(db.scalars(select(PopulationCell).where(PopulationCell.dataset_id == dataset_id, PopulationCell.in_zone.is_(True)).order_by(PopulationCell.id)))
    xy = np.array([[c.x, c.y] for c in rows]).reshape(-1, 2)
    node, snap = graph.snap(xy)
    cells = Cells(
        ids=np.array([c.id for c in rows], dtype=int),
        xy=xy,
        pop=np.array([c.population for c in rows], dtype=float),
        kel=np.array([c.area_code for c in rows], dtype=object),
        node=node,
        snap=snap,
    )
    sh_rows = [s for s in db.scalars(select(Shelter).where(Shelter.dataset_id == dataset_id).order_by(Shelter.name, Shelter.id)) if s.flag != "ditolak" and s.status == "aktif"]
    shelters, meta = shelters_from(graph, [{"id": s.id, "name": s.name, "lon": s.lon, "lat": s.lat, "type": s.type, "capacity": s.capacity, "flag": s.flag, "hypothetical": False} for s in sh_rows])
    areas = list(db.scalars(select(Area).where(Area.dataset_id == dataset_id)))
    b = Bundle(
        dataset_id=dataset_id,
        graph=graph,
        cells=cells,
        shelters=shelters,
        shelter_meta=meta,
        kel_to_kec={a.code: a.parent_code for a in areas if a.level == "kelurahan" and a.parent_code},
        area_names={a.code: a.name for a in areas},
        segment_ids={r.id for r in roads},
    )
    with _lock:
        _cache[dataset_id] = b
    return b


def shelters_from(graph: RoadGraph, meta: list[dict]) -> tuple[Shelters, list[dict]]:
    ll = np.array([[m["lon"], m["lat"]] for m in meta]).reshape(-1, 2)
    if len(ll):
        xs, ys = to_utm(ll[:, 0], ll[:, 1])
        xy = np.column_stack([xs, ys])
    else:
        xy = np.zeros((0, 2))
    node, snap = graph.snap(xy)
    return (
        Shelters(
            ids=np.array([m["id"] for m in meta], dtype=object),
            xy=xy,
            node=node,
            snap=snap,
            capacity=np.array([m["capacity"] if m["capacity"] else np.nan for m in meta], dtype=float),
            names=np.array([m["name"] for m in meta], dtype=object),
        ),
        meta,
    )
