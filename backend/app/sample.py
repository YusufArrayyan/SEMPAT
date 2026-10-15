"""Generator data contoh SINTETIS berbentuk Kota Bengkulu.

Data ini bukan data resmi. Bentuk pesisir, nama kecamatan, dan orde besaran penduduk
dibuat menyerupai Kota Bengkulu agar alur aplikasi dapat dicoba; kelurahan, jalan, TES,
sirene, dan zona genangan seluruhnya rekaan. Ganti dengan data BPBD, BPS, InaRISK,
dan Ina-Geoportal lewat halaman Data.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import unary_union

from .engine.geo import geom_to_lonlat, to_lonlat, to_utm

RNG_SEED = 2026
CELL = 100.0
W, H = 13000.0, 18000.0  # kerangka lokal (m): x ke timur, y ke utara

KECAMATAN = [
    ("1771010", "Kampung Melayu", (5600, 2200), 41000),
    ("1771020", "Selebar", (9800, 3600), 62000),
    ("1771030", "Gading Cempaka", (7200, 8200), 44000),
    ("1771040", "Ratu Agung", (4700, 10000), 49000),
    ("1771050", "Ratu Samban", (3100, 12100), 26000),
    ("1771060", "Teluk Segara", (2500, 13600), 24000),
    ("1771070", "Singaran Pati", (10200, 11000), 46000),
    ("1771080", "Sungai Serut", (5200, 15600), 23000),
    ("1771090", "Muara Bangka Hulu", (9000, 16200), 55000),
]
KEL_COUNT = {"1771010": 5, "1771020": 7, "1771030": 6, "1771040": 6, "1771050": 5, "1771060": 6, "1771070": 5, "1771080": 4, "1771090": 6}


def coast_x(y):
    y = np.asarray(y, dtype=float)
    base = np.where(y < 12500, 1600 + 0.27 * (12500 - y), 1600 + 0.40 * (y - 12500))
    return base + 120 * np.sin(y / 900.0) + 60 * np.sin(y / 310.0)


def river_line() -> LineString:
    ys = np.linspace(0, 1, 40)
    xs = coast_x(16100) - 200 + ys * (W - coast_x(16100) + 400)
    yy = 16100 - 900 * ys + 220 * np.sin(ys * 9)
    return LineString(list(zip(xs, yy)))


LAKE = Point(8300, 9200).buffer(650)


def origin_utm() -> tuple[float, float]:
    x, y = to_utm(102.236, -3.902)
    return float(np.floor(x / CELL) * CELL), float(np.floor(y / CELL) * CELL)


def generate(out_dir: Path) -> dict:
    rng = np.random.default_rng(RNG_SEED)
    out_dir.mkdir(parents=True, exist_ok=True)
    ox, oy = origin_utm()
    river = river_line()
    river_poly = river.buffer(35)

    # Daratan
    ys = np.arange(0, H + 1, 100.0)
    land = Polygon([(float(coast_x(y)), y) for y in ys] + [(W, H), (W, 0)]).buffer(0)
    land = land.difference(LAKE).difference(river_poly)

    # Sel 100 m daratan
    gxs = np.arange(int(W // CELL))
    gys = np.arange(int(H // CELL))
    GX, GY = np.meshgrid(gxs, gys)
    cx = (GX.ravel() + 0.5) * CELL
    cy = (GY.ravel() + 0.5) * CELL
    import shapely

    on_land = shapely.contains_xy(land, cx, cy)
    cells = np.column_stack([GX.ravel()[on_land], GY.ravel()[on_land]])
    centers = (cells + 0.5) * CELL

    # Kecamatan: Voronoi dari titik benih dengan sedikit derau tepi
    seeds = np.array([k[2] for k in KECAMATAN], dtype=float)
    # Derau halus (bukan acak per sel) agar batas berkelok tetapi wilayah tetap utuh.
    jx = 320 * np.sin(centers[:, 1] / 1100.0) + 160 * np.sin(centers[:, 1] / 430.0 + 1.3)
    jy = 320 * np.cos(centers[:, 0] / 1300.0) + 160 * np.sin(centers[:, 0] / 520.0 + 0.4)
    jitter = np.column_stack([jx, jy])
    d2 = ((centers[:, None, :] + jitter[:, None, :] - seeds[None, :, :]) ** 2).sum(-1)
    kec_idx = d2.argmin(1)

    # Kelurahan: Voronoi di dalam kecamatan
    kel_records = []
    kel_of_cell = np.empty(len(centers), dtype=object)
    for ki, (kcode, kname, _, kpop) in enumerate(KECAMATAN):
        idx = np.where(kec_idx == ki)[0]
        n = KEL_COUNT[kcode]
        pick = rng.choice(idx, size=n, replace=False)
        sub = centers[pick]
        dd = ((centers[idx][:, None, :] - sub[None, :, :]) ** 2).sum(-1)
        sub_idx = dd.argmin(1)
        weights = rng.dirichlet(np.full(n, 6.0))
        for s in range(n):
            code = f"{kcode}{s + 1:03d}"
            kel_of_cell[idx[sub_idx == s]] = code
            kel_records.append({"code": code, "name": f"{kname} {s + 1:02d}", "parent": kcode, "pop": int(round(kpop * weights[s]))})

    def to_ll(geom):
        from shapely.affinity import translate

        return geom_to_lonlat(translate(geom, ox, oy))

    def squares(mask):
        g = cells[mask]
        return unary_union([box(x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL) for x, y in g])

    area_feats = []
    for ki, (kcode, kname, _, _) in enumerate(KECAMATAN):
        geom = to_ll(squares(kec_idx == ki).simplify(0))
        area_feats.append({"type": "Feature", "properties": {"kode": kcode, "nama": kname, "tingkat": "kecamatan"}, "geometry": _round(mapping(geom))})
    for k in kel_records:
        geom = to_ll(squares(kel_of_cell == k["code"]).simplify(0))
        area_feats.append({"type": "Feature", "properties": {"kode": k["code"], "nama": k["name"], "tingkat": "kelurahan", "kode_induk": k["parent"]}, "geometry": _round(mapping(geom))})
    _write_json(out_dir / "wilayah.geojson", {"type": "FeatureCollection", "name": "batas_wilayah_sintetis", "features": area_feats})

    with open(out_dir / "penduduk.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["kode", "nama", "penduduk", "tahun"])
        for k in kel_records:
            w.writerow([k["code"], k["name"], k["pop"], 2024])

    # Zona genangan: sabuk pesisir dengan lebar bervariasi + muara sungai
    pts = [Point(float(coast_x(y)), y).buffer(1500 + 650 * np.sin(y / 2300.0) + 250 * np.sin(y / 700.0)) for y in np.arange(0, H + 1, 150.0)]
    upstream = LineString(list(river.coords)[:14]).buffer(550)
    zone = unary_union(pts + [upstream]).intersection(box(-2000, 0, W, H)).simplify(20)
    zone_ll = to_ll(zone)
    _write_json(
        out_dir / "genangan.geojson",
        {"type": "FeatureCollection", "name": "zona_genangan_sintetis", "features": [{"type": "Feature", "properties": {"sumber": "Sintetis (contoh); ganti dengan InaRISK"}, "geometry": _round(mapping(zone_ll))}]},
    )

    # Jaringan jalan: kisi 250 m berderau, arteri, jalan pesisir, jembatan terbatas
    sp = 250.0
    nx, ny = int(W // sp) + 1, int(H // sp) + 1
    node = {}
    for i in range(nx):
        for j in range(ny):
            x = i * sp + rng.uniform(-35, 35)
            y = j * sp + rng.uniform(-35, 35)
            if x > coast_x(y) + 120 and not LAKE.buffer(40).contains(Point(x, y)):
                node[(i, j)] = (x, y)
    bridges_x = [coast_x(16000) + 900, 7600, 10800]
    feats = []

    def add(fid, coords, kelas, nama=""):
        ll = [to_lonlat(x + ox, y + oy) for x, y in coords]
        feats.append({"type": "Feature", "properties": {"id": fid, "kelas": kelas, "nama": nama}, "geometry": {"type": "LineString", "coordinates": [[round(a, 7), round(b, 7)] for a, b in ll]}})

    for (i, j), a in node.items():
        for di, dj, tag in ((1, 0, "h"), (0, 1, "v")):
            b = node.get((i + di, j + dj))
            if b is None:
                continue
            seg = LineString([a, b])
            arterial = (tag == "h" and j % 6 == 0) or (tag == "v" and i % 6 == 0)
            if seg.intersects(river_poly):
                mid_x = (a[0] + b[0]) / 2
                if not (tag == "v" and any(abs(mid_x - bx) < sp * 0.6 for bx in bridges_x)):
                    continue
                kelas, nama = "jembatan", f"Jembatan {chr(65 + int(np.argmin([abs(mid_x - bx) for bx in bridges_x])))}"
                add(f"{tag}_{i}_{j}", [a, b], kelas, nama)
                continue
            if seg.intersects(LAKE):
                continue
            if not arterial and rng.random() < 0.2:
                continue
            add(f"{tag}_{i}_{j}", [a, b], "arteri" if arterial else "lokal")

    # Jalan pesisir (sejajar garis pantai, 160 m ke darat) dan sambungan ke kisi
    ys_c = np.arange(200, H - 200, 120.0)
    coast_road = [(float(coast_x(y)) + 160, float(y)) for y in ys_c]
    coast_road = [p for p in coast_road if not river_poly.buffer(10).contains(Point(p))]
    pieces, cur = [], [coast_road[0]]
    for p in coast_road[1:]:
        if abs(p[1] - cur[-1][1]) > 150 or LineString([cur[-1], p]).intersects(river_poly):
            pieces.append(cur)
            cur = [p]
        else:
            cur.append(p)
    pieces.append(cur)
    for pi, piece in enumerate(pieces):
        for k in range(len(piece) - 1):
            add(f"pesisir_{pi}_{k}", [piece[k], piece[k + 1]], "pesisir", "Jalan Pesisir")
    for j in range(ny):
        row = sorted((i, p) for (i, jj), p in node.items() if jj == j)
        if not row:
            continue
        p = row[0][1]
        y = p[1]
        cp = min((q for piece in pieces for q in piece), key=lambda q: (q[0] - p[0]) ** 2 + (q[1] - y) ** 2)
        if np.hypot(cp[0] - p[0], cp[1] - p[1]) < 420 and not LineString([cp, p]).intersects(river_poly):
            add(f"sambung_{j}", [cp, p], "lokal")
    _write_json(out_dir / "jalan.geojson", {"type": "FeatureCollection", "name": "jaringan_jalan_sintetis", "features": feats})

    # TES
    tes_rows = []
    vertical_names = ["Gedung sekolah", "Masjid", "Kantor pemerintah", "Hotel", "Gedung serbaguna", "Pusat belanja", "Kampus", "Rumah sakit"]
    vy = np.linspace(900, H - 1300, 15)
    for n_, y in enumerate(vy):
        x = float(coast_x(y)) + rng.uniform(450, 1300)
        cap = None if n_ % 5 == 3 else int(rng.integers(4, 30) * 100)
        tes_rows.append([f"TES Vertikal {n_ + 1:02d} ({vertical_names[n_ % len(vertical_names)]})", x, y, "vertikal", cap])
    hy = np.linspace(1500, H - 1200, 10)
    for n_, y in enumerate(hy):
        zx = _zone_edge_x(zone, y)
        x = zx + rng.uniform(150, 450)
        cap = None if n_ % 4 == 2 else int(rng.integers(30, 120) * 100)
        tes_rows.append([f"TES Dataran Tinggi {n_ + 1:02d}", x, y, "dataran_tinggi", cap])
    # Dua baris contoh untuk validasi: dataran tinggi di zona (ditolak) dan tipe tak diketahui
    tes_rows.append(["TES Dataran Tinggi 11 (koordinat perlu dicek)", float(coast_x(7000)) + 500, 7000.0, "dataran_tinggi", 5000])
    tes_rows.append(["TES Balai Pertemuan (tipe belum diisi)", float(coast_x(11200)) + 900, 11200.0, "tak_diketahui", None])
    with open(out_dir / "tes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["nama", "lon", "lat", "tipe", "kapasitas", "status"])
        for name, x, y, t, cap in tes_rows:
            lon, lat = to_lonlat(x + ox, y + oy)
            w.writerow([name, f"{lon:.6f}", f"{lat:.6f}", t, "" if cap is None else cap, "aktif"])

    # Sirene
    sir = []
    for n_, y in enumerate(np.linspace(1500, H - 1500, 6)):
        lon, lat = to_lonlat(float(coast_x(y)) + 300 + ox, y + oy)
        sir.append({"type": "Feature", "properties": {"nama": f"Sirene {n_ + 1}", "status": "aktif" if n_ != 4 else "rusak"}, "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    _write_json(out_dir / "sirene.geojson", {"type": "FeatureCollection", "name": "sirene_sintetis", "features": sir})

    (out_dir / "README.md").write_text(
        "# Data contoh sintetis\n\n"
        "Berkas di folder ini dibuat oleh `app/sample.py` (benih 2026) dan **bukan data resmi**.\n"
        "Bentuknya meniru Kota Bengkulu agar alur Sempat dapat dicoba dari awal sampai laporan.\n\n"
        "| Berkas | Jenis impor |\n|---|---|\n"
        "| tes.csv | TES |\n| jalan.geojson | Jaringan jalan |\n| wilayah.geojson | Batas kecamatan dan kelurahan |\n"
        "| penduduk.csv | Penduduk per kelurahan |\n| genangan.geojson | Zona genangan |\n| sirene.geojson | Sirene |\n",
        encoding="utf-8",
    )
    return {"kelurahan": len(kel_records), "roads": len(feats), "tes": len(tes_rows)}


def _zone_edge_x(zone, y: float) -> float:
    line = LineString([(-3000, y), (W, y)])
    inter = zone.intersection(line)
    if inter.is_empty:
        return float(coast_x(y)) + 1500
    return float(inter.bounds[2])


def _round(g: dict) -> dict:
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 7), round(c[1], 7)]
        return [r(x) for x in c]

    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
