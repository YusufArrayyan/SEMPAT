"""Impor berkas data (FR-01 s.d. FR-04). Setiap baris tak valid ditolak dengan alasan."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from dataclasses import dataclass, field

from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.validation import explain_validity, make_valid

KINDS = {
    "tes": "Tempat evakuasi sementara (TES)",
    "jalan": "Jaringan jalan",
    "wilayah": "Batas kecamatan dan kelurahan",
    "penduduk": "Penduduk per kelurahan",
    "genangan": "Zona genangan tsunami",
    "sirene": "Lokasi sirene",
}
REQUIRED_KINDS = ["tes", "jalan", "wilayah", "penduduk", "genangan"]
SHELTER_TYPES = {"vertikal", "dataran_tinggi", "tak_diketahui"}


class ImportError_(Exception):
    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.message = message
        self.hint = hint


@dataclass
class Parsed:
    rows: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    crs: str = "EPSG:4326"


def _first(props: dict, *keys, default=None):
    low = {str(k).lower(): v for k, v in props.items()}
    for k in keys:
        if k in low and low[k] not in (None, ""):
            return low[k]
    return default


def _detect_crs(doc: dict) -> str | None:
    crs = doc.get("crs")
    if isinstance(crs, dict):
        name = (crs.get("properties") or {}).get("name", "")
        if name:
            try:
                return CRS.from_user_input(name.replace("urn:ogc:def:crs:", "").replace("::", ":")).to_string()
            except Exception:
                return name
    return None


def _transformer(src: str | None):
    if not src or src in ("EPSG:4326", "OGC:CRS84"):
        return None
    try:
        return Transformer.from_crs(src, 4326, always_xy=True)
    except Exception as e:  # noqa: BLE001
        raise ImportError_(f"Sistem koordinat {src} tidak dikenali.", "Simpan ulang berkas dalam EPSG:4326 atau EPSG:32748.") from e


def _reproject(geom, tr):
    if tr is None:
        return geom
    from shapely.ops import transform

    return transform(lambda x, y, z=None: tr.transform(x, y), geom)


def _looks_projected(geom) -> bool:
    minx, miny, maxx, maxy = geom.bounds
    return abs(minx) > 180 or abs(maxx) > 180 or abs(miny) > 90 or abs(maxy) > 90


def _load_features(data: bytes, filename: str) -> tuple[list[dict], str]:
    name = filename.lower()
    if name.endswith(".zip"):
        return _load_shapefile_zip(data)
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except Exception as e:  # noqa: BLE001
        raise ImportError_("Berkas bukan GeoJSON yang sah.", "Periksa bahwa berkas berformat GeoJSON (UTF-8) atau Shapefile ZIP.") from e
    if doc.get("type") == "FeatureCollection":
        feats = doc.get("features") or []
    elif doc.get("type") == "Feature":
        feats = [doc]
    else:
        raise ImportError_("GeoJSON harus berupa FeatureCollection.", "Bungkus geometri dalam FeatureCollection.")
    return feats, _detect_crs(doc) or "EPSG:4326"


def _load_shapefile_zip(data: bytes) -> tuple[list[dict], str]:
    import shapefile  # pyshp

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ImportError_("Berkas ZIP rusak.", "Kompres ulang berkas .shp, .shx, .dbf, dan .prj.") from e
    names = zf.namelist()
    base = next((n[:-4] for n in names if n.lower().endswith(".shp")), None)
    if base is None:
        raise ImportError_("ZIP tidak memuat berkas .shp.", "Sertakan .shp, .shx, .dbf, dan .prj dalam satu ZIP.")

    def get(ext):
        for n in names:
            if n.lower() == (base + ext).lower():
                return io.BytesIO(zf.read(n))
        return None

    crs = "EPSG:4326"
    prj = get(".prj")
    if prj is not None:
        try:
            crs = CRS.from_wkt(prj.read().decode("utf-8", "ignore")).to_string()
        except Exception:  # noqa: BLE001
            pass
    r = shapefile.Reader(shp=get(".shp"), shx=get(".shx"), dbf=get(".dbf"))
    fields = [f[0] for f in r.fields[1:]]
    feats = []
    for sr in r.iterShapeRecords():
        feats.append({"type": "Feature", "geometry": sr.shape.__geo_interface__, "properties": dict(zip(fields, sr.record))})
    return feats, crs


def _geom(feat: dict, tr, allowed: tuple[str, ...], parsed: Parsed, i: int):
    g = feat.get("geometry")
    if not g:
        parsed.rejected.append({"row": i, "reason": "Geometri kosong."})
        return None
    try:
        geom = shape(g)
    except Exception:  # noqa: BLE001
        parsed.rejected.append({"row": i, "reason": "Geometri tidak dapat dibaca."})
        return None
    if geom.geom_type not in allowed:
        parsed.rejected.append({"row": i, "reason": f"Tipe geometri {geom.geom_type}; yang diterima: {', '.join(allowed)}."})
        return None
    if tr is None and _looks_projected(geom):
        tr_local = _transformer("EPSG:32748")
        geom = _reproject(geom, tr_local)
        parsed.crs = "EPSG:32748 (diduga dari nilai koordinat)"
    else:
        geom = _reproject(geom, tr)
    if not geom.is_valid:
        reason = explain_validity(geom)
        fixed = make_valid(geom)
        if fixed.is_empty:
            parsed.rejected.append({"row": i, "reason": f"Geometri tidak valid: {reason}."})
            return None
        parsed.warnings.append(f"Baris {i}: geometri diperbaiki otomatis ({reason}).")
        geom = fixed
    return geom


def _read_csv(data: bytes) -> list[dict]:
    text = data.decode("utf-8-sig")
    sample = text[:2048]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))


def _num(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def parse_shelters(data: bytes, filename: str) -> Parsed:
    p = Parsed()
    if filename.lower().endswith(".csv"):
        for i, r in enumerate(_read_csv(data), start=2):
            props = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
            lon = _num(_first(props, "lon", "bujur", "longitude", "x"))
            lat = _num(_first(props, "lat", "lintang", "latitude", "y"))
            _shelter_row(p, i, props, lon, lat)
    else:
        feats, crs = _load_features(data, filename)
        p.crs = crs
        tr = _transformer(crs)
        for i, f in enumerate(feats, start=1):
            g = _geom(f, tr, ("Point",), p, i)
            if g is None:
                continue
            props = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
            _shelter_row(p, i, props, g.x, g.y)
    return p


def _shelter_row(p: Parsed, i: int, props: dict, lon, lat):
    name = str(_first(props, "nama", "name", default="")).strip()
    tipe = str(_first(props, "tipe", "type", default="tak_diketahui")).strip().lower().replace(" ", "_")
    cap = _num(_first(props, "kapasitas", "capacity"))
    status = str(_first(props, "status", default="aktif")).strip().lower()
    if not name:
        p.rejected.append({"row": i, "reason": "Kolom nama kosong."})
        return
    if lon is None or lat is None:
        p.rejected.append({"row": i, "reason": "Koordinat lon/lat kosong atau bukan angka."})
        return
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        p.rejected.append({"row": i, "reason": f"Koordinat di luar rentang derajat ({lon}, {lat})."})
        return
    if tipe not in SHELTER_TYPES:
        p.rejected.append({"row": i, "reason": f"Tipe '{tipe}' tidak dikenal; gunakan vertikal, dataran_tinggi, atau tak_diketahui."})
        return
    if cap is not None and cap < 0:
        p.rejected.append({"row": i, "reason": "Kapasitas negatif."})
        return
    p.rows.append({"name": name, "lon": float(lon), "lat": float(lat), "type": tipe, "capacity": int(cap) if cap else None, "status": status or "aktif"})


def parse_roads(data: bytes, filename: str) -> Parsed:
    p = Parsed()
    feats, crs = _load_features(data, filename)
    p.crs = crs
    tr = _transformer(crs)
    seen = set()
    for i, f in enumerate(feats, start=1):
        g = _geom(f, tr, ("LineString", "MultiLineString"), p, i)
        if g is None:
            continue
        props = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
        base_id = str(_first(props, "id", "fid", "osm_id", default=f"r{i}"))
        parts = list(g.geoms) if g.geom_type == "MultiLineString" else [g]
        for pi, part in enumerate(parts):
            coords = [(round(x, 7), round(y, 7)) for x, y, *_ in part.coords]
            if len(coords) < 2:
                p.rejected.append({"row": i, "reason": "Garis memiliki kurang dari dua titik."})
                continue
            sid = base_id if len(parts) == 1 else f"{base_id}_{pi}"
            while sid in seen:
                sid += "_"
            seen.add(sid)
            p.rows.append(
                {
                    "id": sid[:40],
                    "coords": coords,
                    "road_class": str(_first(props, "kelas", "class", "highway", "fclass", default="")),
                    "name": str(_first(props, "nama", "name", default="")),
                }
            )
    return p


def parse_areas(data: bytes, filename: str) -> Parsed:
    p = Parsed()
    feats, crs = _load_features(data, filename)
    p.crs = crs
    tr = _transformer(crs)
    for i, f in enumerate(feats, start=1):
        g = _geom(f, tr, ("Polygon", "MultiPolygon"), p, i)
        if g is None:
            continue
        props = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
        code = str(_first(props, "kode", "code", "kode_wilayah", default="")).strip()
        name = str(_first(props, "nama", "name", default="")).strip()
        level = str(_first(props, "tingkat", "level", default="kelurahan")).strip().lower()
        parent = str(_first(props, "kode_induk", "parent_code", "kode_kecamatan", default="")).strip() or None
        if not code or not name:
            p.rejected.append({"row": i, "reason": "Kolom kode atau nama kosong."})
            continue
        if level not in ("kecamatan", "kelurahan"):
            p.rejected.append({"row": i, "reason": f"Tingkat '{level}' tidak dikenal; gunakan kecamatan atau kelurahan."})
            continue
        if level == "kelurahan" and not parent:
            p.rejected.append({"row": i, "reason": "Kelurahan tanpa kode_induk (kode kecamatan)."})
            continue
        p.rows.append({"code": code, "name": name, "level": level, "parent_code": parent, "geom": mapping(g)})
    return p


def parse_population(data: bytes, filename: str) -> Parsed:
    p = Parsed(crs="-")
    if not filename.lower().endswith(".csv"):
        raise ImportError_("Penduduk harus berupa CSV.", "Gunakan kolom kode, penduduk, dan tahun (opsional).")
    for i, r in enumerate(_read_csv(data), start=2):
        props = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        code = _first(props, "kode", "code", "kode_wilayah", default="")
        pop = _num(_first(props, "penduduk", "population", "jumlah"))
        year = _num(_first(props, "tahun", "year"))
        if not code:
            p.rejected.append({"row": i, "reason": "Kolom kode kosong."})
            continue
        if pop is None:
            p.rejected.append({"row": i, "reason": "Kolom penduduk kosong atau bukan angka."})
            continue
        p.rows.append({"code": str(code), "population": pop, "year": int(year) if year else None})
    return p


def parse_zones(data: bytes, filename: str) -> Parsed:
    p = Parsed()
    feats, crs = _load_features(data, filename)
    p.crs = crs
    tr = _transformer(crs)
    for i, f in enumerate(feats, start=1):
        g = _geom(f, tr, ("Polygon", "MultiPolygon"), p, i)
        if g is None:
            continue
        props = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
        p.rows.append({"geom": mapping(g), "source": str(_first(props, "sumber", "source", default=""))})
    return p


def parse_sirens(data: bytes, filename: str) -> Parsed:
    p = Parsed()
    if filename.lower().endswith(".csv"):
        for i, r in enumerate(_read_csv(data), start=2):
            props = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
            lon = _num(_first(props, "lon", "bujur", "x"))
            lat = _num(_first(props, "lat", "lintang", "y"))
            if lon is None or lat is None:
                p.rejected.append({"row": i, "reason": "Koordinat kosong."})
                continue
            p.rows.append({"name": str(_first(props, "nama", "name", default="")), "lon": lon, "lat": lat, "status": str(_first(props, "status", default="aktif"))})
        return p
    feats, crs = _load_features(data, filename)
    p.crs = crs
    tr = _transformer(crs)
    for i, f in enumerate(feats, start=1):
        g = _geom(f, tr, ("Point",), p, i)
        if g is None:
            continue
        props = {str(k).lower(): v for k, v in (f.get("properties") or {}).items()}
        p.rows.append({"name": str(_first(props, "nama", "name", default="")), "lon": g.x, "lat": g.y, "status": str(_first(props, "status", default="aktif"))})
    return p


PARSERS = {
    "tes": parse_shelters,
    "jalan": parse_roads,
    "wilayah": parse_areas,
    "penduduk": parse_population,
    "genangan": parse_zones,
    "sirene": parse_sirens,
}

ALLOWED_EXT = {
    "tes": (".csv", ".geojson", ".json"),
    "jalan": (".geojson", ".json", ".zip"),
    "wilayah": (".geojson", ".json", ".zip"),
    "penduduk": (".csv",),
    "genangan": (".geojson", ".json", ".zip"),
    "sirene": (".csv", ".geojson", ".json"),
}


def sniff_ok(data: bytes, filename: str) -> bool:
    """Pemeriksaan tipe isi, bukan hanya ekstensi."""
    name = filename.lower()
    head = data[:8]
    if name.endswith(".zip"):
        return head.startswith(b"PK\x03\x04")
    if b"\x00" in data[:4096]:
        return False
    if name.endswith((".geojson", ".json")):
        return data.lstrip(b"\xef\xbb\xbf \r\n\t")[:1] == b"{"
    return True
