"""Sisa waktu, kelas, indeks kecukupan, beban TES, prioritas, dan Monte Carlo.

Rumus (PRD bagian 3):
    v    = v_moda * f_malam
    t_i  = d_i / (60 v)
    m_i  = T_a - (tau + t_i)
    IK_k = sum P_i [m_i >= 0] / sum P_i
    B_j  = sum_{i->j} P_i / C_j
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy.sparse import csr_matrix

from .graph import NearestResult, RoadGraph, nearest_shelter

MAX_SNAP_M = 200.0

CUKUP, RAWAN, TERLAMBAT, TERPUTUS = 0, 1, 2, 3
CLASS_NAMES = ["cukup", "rawan", "terlambat", "terputus"]


@dataclass
class Params:
    delay_min: float
    arrival_min: float
    mode: str
    speed_ms: float
    night: bool
    night_factor: float
    buffer_min: float
    detour_threshold: float = 1.5

    def velocity(self, night: bool | None = None) -> float:
        use_night = self.night if night is None else night
        return self.speed_ms * (self.night_factor if use_night else 1.0)

    def validate(self) -> list[str]:
        errs = []
        if self.delay_min < 0:
            errs.append("Jeda respons harus >= 0 menit.")
        if self.arrival_min <= 0:
            errs.append("Waktu tiba gelombang harus > 0 menit.")
        if self.speed_ms <= 0:
            errs.append("Kecepatan harus > 0 m/detik.")
        if not (0 < self.night_factor <= 1):
            errs.append("Faktor malam harus di antara 0 dan 1.")
        if self.buffer_min < 0:
            errs.append("Margin pengaman harus >= 0 menit.")
        if self.mode not in ("jalan_kaki", "kendaraan"):
            errs.append("Moda harus jalan_kaki atau kendaraan.")
        return errs

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Cells:
    ids: np.ndarray
    xy: np.ndarray
    pop: np.ndarray
    kel: np.ndarray  # kode kelurahan per sel
    node: np.ndarray
    snap: np.ndarray


@dataclass
class Shelters:
    ids: np.ndarray  # object
    xy: np.ndarray
    node: np.ndarray
    snap: np.ndarray
    capacity: np.ndarray  # nan = belum diketahui
    names: np.ndarray | None = None

    def label(self, j: int) -> str:
        return str(self.names[j]) if self.names is not None else str(self.ids[j])


@dataclass
class Distances:
    dist: np.ndarray  # inf = terputus
    shelter: np.ndarray  # indeks TES, -1 bila terputus
    euclid: np.ndarray  # jarak garis lurus sel -> TES penugasan
    nearest: NearestResult


def cell_distances(graph: RoadGraph, cells: Cells, shelters: Shelters, blocked: set[str] | None = None) -> Distances:
    res = nearest_shelter(graph, shelters.node, shelters.snap, blocked)
    if graph.n_nodes == 0 or len(cells.ids) == 0:
        c = len(cells.ids)
        return Distances(np.full(c, np.inf), np.full(c, -1), np.full(c, np.nan), res)
    nd = res.dist[cells.node]
    sh = res.source[cells.node]
    dist = cells.snap + nd
    disconnected = (cells.snap > MAX_SNAP_M) | ~np.isfinite(nd) | (sh < 0)
    dist = np.where(disconnected, np.inf, dist)
    sh = np.where(disconnected, -1, sh)
    euclid = np.full(len(dist), np.nan)
    ok = sh >= 0
    if ok.any():
        euclid[ok] = np.hypot(*(cells.xy[ok] - shelters.xy[sh[ok]]).T)
    return Distances(dist, sh, euclid, res)


def classify(dist: np.ndarray, p: Params, delay: float | None = None, night: bool | None = None):
    tau = p.delay_min if delay is None else delay
    v = p.velocity(night)
    with np.errstate(invalid="ignore"):
        t = dist / (60.0 * v)
        m = p.arrival_min - (tau + t)
    cls = np.full(len(dist), TERPUTUS, dtype=np.int8)
    fin = np.isfinite(dist)
    cls[fin & (m >= p.buffer_min)] = CUKUP
    cls[fin & (m >= 0) & (m < p.buffer_min)] = RAWAN
    cls[fin & (m < 0)] = TERLAMBAT
    return t, m, cls


def aggregate(pop: np.ndarray, kel: np.ndarray, cls: np.ndarray, margin: np.ndarray, kel_to_kec: dict[str, str]):
    """Statistik per kelurahan dan kecamatan. IK memakai seluruh penduduk sel terdampak."""
    out: dict[str, dict] = {}

    def acc(code: str, level: str, mask: np.ndarray):
        P = pop[mask]
        c = cls[mask]
        m = margin[mask]
        total = float(P.sum())
        late = c == TERLAMBAT
        pop_late = float(P[late].sum())
        deficit = float((-m[late] * P[late]).sum() / pop_late) if pop_late > 0 else 0.0
        sempat = float(P[(c == CUKUP) | (c == RAWAN)].sum())
        out[code] = {
            "area_code": code,
            "level": level,
            "pop_total": total,
            "pop_cukup": float(P[c == CUKUP].sum()),
            "pop_rawan": float(P[c == RAWAN].sum()),
            "pop_late": pop_late,
            "pop_terputus": float(P[c == TERPUTUS].sum()),
            "ik": (sempat / total) if total > 0 else None,
            "mean_deficit": deficit,
        }

    for code in sorted(set(kel.tolist())):
        acc(code, "kelurahan", kel == code)
    kec_codes = np.array([kel_to_kec.get(k, "") for k in kel], dtype=object)
    for code in sorted(set(kec_codes.tolist())):
        if code:
            acc(code, "kecamatan", kec_codes == code)
    total_mask = np.ones(len(pop), dtype=bool)
    acc("__total__", "kota", total_mask)
    return out


def shelter_loads(pop: np.ndarray, d: Distances, shelters: Shelters) -> list[dict]:
    k = len(shelters.ids)
    assigned = np.zeros(k)
    ok = d.shelter >= 0
    np.add.at(assigned, d.shelter[ok], pop[ok])
    rows = []
    for j in range(k):
        cap = shelters.capacity[j]
        known = bool(np.isfinite(cap) and cap > 0)
        rows.append(
            {
                "shelter_id": str(shelters.ids[j]),
                "assigned_pop": float(assigned[j]),
                "capacity": float(cap) if known else None,
                "load": float(assigned[j] / cap) if known else None,
            }
        )
    return rows


def _id(v: float, decimals: int | None = None) -> str:
    """Angka gaya Indonesia: koma desimal."""
    s = f"{v:.{decimals}f}" if decimals is not None else f"{v:g}"
    return s.replace(".", ",")


def priorities(
    pop: np.ndarray,
    kel: np.ndarray,
    d: Distances,
    p: Params,
    loads: list[dict],
    shelters: Shelters,
) -> list[dict]:
    """Aturan 1-5 (PRD bagian 3). Satu kategori utama + 0-3 penanda per kelurahan."""
    _, m_base, cls_base = classify(d.dist, p)
    _, _, cls_tau0 = classify(d.dist, p, delay=0.0)
    _, _, cls_day = classify(d.dist, p, night=False)
    _, _, cls_night = classify(d.dist, p, night=True)
    load_by_idx = {j: loads[j]["load"] for j in range(len(loads))}

    items = []
    for code in sorted(set(kel.tolist())):
        mk = kel == code
        late = mk & (cls_base == TERLAMBAT)
        pop_late = float(pop[late].sum())
        if pop_late <= 0:
            continue
        deficit = float((-m_base[late] * pop[late]).sum() / pop_late)
        reasons = []
        late_tau0 = float(pop[mk & (cls_tau0 == TERLAMBAT)].sum())
        if late_tau0 > 0:
            category = "tambah_tes"
            reasons.append(
                {
                    "rule": 1,
                    "text": "Ada penduduk Terlambat walaupun jeda respons 0 menit.",
                    "value": f"{late_tau0:,.0f} jiwa terlambat pada jeda 0".replace(",", "."),
                }
            )
        else:
            category = "percepat_respons"
            reasons.append(
                {
                    "rule": 2,
                    "text": f"Penduduk Terlambat hanya muncul karena jeda respons {_id(p.delay_min)} menit.",
                    "value": f"{pop_late:,.0f} jiwa; 0 jiwa pada jeda 0".replace(",", "."),
                }
            )
        flags = []
        with np.errstate(invalid="ignore", divide="ignore"):
            ratio = d.dist / d.euclid
        detour = late & np.isfinite(ratio) & (ratio > p.detour_threshold)
        if detour.any():
            flags.append("perbaiki_rute")
            reasons.append(
                {
                    "rule": 3,
                    "text": f"Rasio jarak jaringan terhadap garis lurus > {_id(p.detour_threshold)} pada sel Terlambat.",
                    "value": f"{int(detour.sum())} sel; rasio maks {_id(float(np.nanmax(ratio[detour])), 2)}",
                }
            )
        late_day = float(pop[mk & (cls_day == TERLAMBAT)].sum())
        late_night = float(pop[mk & (cls_night == TERLAMBAT)].sum())
        if late_night > late_day:
            flags.append("penerangan")
            reasons.append(
                {
                    "rule": 4,
                    "text": f"Penduduk Terlambat bertambah saat faktor malam {_id(p.night_factor)} diterapkan.",
                    "value": f"{late_day:,.0f} → {late_night:,.0f} jiwa".replace(",", "."),
                }
            )
        served = sorted(set(d.shelter[mk & (d.shelter >= 0)].tolist()))
        over = [j for j in served if load_by_idx.get(j) is not None and load_by_idx[j] > 1]
        if over:
            flags.append("perluas_kapasitas")
            names = ", ".join(f"{shelters.label(j)} (B = {_id(load_by_idx[j], 2)})" for j in over[:3])
            reasons.append(
                {
                    "rule": 5,
                    "text": "TES yang melayani kelurahan ini kelebihan beban (B > 1).",
                    "value": names,
                }
            )
        items.append(
            {
                "area_code": code,
                "category": category,
                "flags": flags,
                "pop_late": pop_late,
                "mean_deficit": deficit,
                "rationale": reasons,
            }
        )
    items.sort(key=lambda r: (-r["pop_late"], -r["mean_deficit"], r["area_code"]))
    for i, it in enumerate(items, start=1):
        it["rank"] = i
    return items


def area_matrix(kel: np.ndarray, kel_to_kec: dict[str, str]):
    """Matriks indikator (area x sel) untuk agregasi cepat Monte Carlo."""
    kel_codes = sorted(set(kel.tolist()))
    kec_codes = sorted({kel_to_kec.get(k, "") for k in kel_codes} - {""})
    codes = kel_codes + kec_codes + ["__total__"]
    index = {c: i for i, c in enumerate(codes)}
    rows, cols = [], []
    for ci, k in enumerate(kel):
        rows.append(index[k])
        cols.append(ci)
        kc = kel_to_kec.get(k)
        if kc:
            rows.append(index[kc])
            cols.append(ci)
        rows.append(index["__total__"])
        cols.append(ci)
    A = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(codes), len(kel)))
    return codes, A


def monte_carlo(
    dist: np.ndarray,
    pop: np.ndarray,
    kel: np.ndarray,
    kel_to_kec: dict[str, str],
    p: Params,
    tri: dict,
    n: int,
    seed: int,
    cancel=None,
    progress=None,
) -> dict[str, dict]:
    """N undian sebaran segitiga atas tau, T_a, v. Jarak d_i dipakai ulang."""
    rng = np.random.default_rng(seed)
    tau = rng.triangular(*tri["delay"], size=n)
    ta = rng.triangular(*tri["arrival"], size=n)
    v = rng.triangular(*tri["speed"], size=n) * (p.night_factor if p.night else 1.0)
    codes, A = area_matrix(kel, kel_to_kec)
    totals = np.asarray(A @ pop).ravel()
    iks = np.zeros((len(codes), n))
    chunk = 100
    for s in range(0, n, chunk):
        if cancel and cancel():
            raise InterruptedError
        e = min(n, s + chunk)
        with np.errstate(invalid="ignore"):
            m = ta[None, s:e] - tau[None, s:e] - dist[:, None] / (60.0 * v[None, s:e])
        ok = np.where(np.isfinite(m) & (m >= 0), pop[:, None], 0.0)
        sempat = A @ ok
        with np.errstate(invalid="ignore", divide="ignore"):
            iks[:, s:e] = np.where(totals[:, None] > 0, sempat / totals[:, None], np.nan)
        if progress:
            progress(e / n)
    out = {}
    for i, c in enumerate(codes):
        row = iks[i]
        if np.all(np.isnan(row)):
            out[c] = {"ik_p5": None, "ik_p50": None, "ik_p95": None}
        else:
            p5, p50, p95 = np.nanpercentile(row, [5, 50, 95])
            out[c] = {"ik_p5": float(p5), "ik_p50": float(p50), "ik_p95": float(p95)}
    return out


MATRIX_DELAYS = [0.0, 5.0, 10.0]
MATRIX_ARRIVALS = [20.0, 25.0]
MATRIX_MODES = ["jalan_kaki", "kendaraan"]
DEFAULT_SPEEDS = {"jalan_kaki": 1.09, "kendaraan": 2.49}


def matrix_variants(p: Params, speeds: dict[str, float] | None = None) -> list[tuple[str, Params]]:
    speeds = speeds or DEFAULT_SPEEDS
    out = []
    for tau in MATRIX_DELAYS:
        for ta in MATRIX_ARRIVALS:
            for mode in MATRIX_MODES:
                q = Params(**{**p.to_dict(), "delay_min": tau, "arrival_min": ta, "mode": mode, "speed_ms": speeds[mode]})
                out.append((f"tau{tau:g}_ta{ta:g}_{mode}", q))
    return out
