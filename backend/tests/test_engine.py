"""Uji mesin hitung pada graf mainan dengan jawaban hitung tangan (PRD 8.3)."""

import numpy as np
import pytest

from app.engine.compute import (
    CUKUP,
    RAWAN,
    TERLAMBAT,
    TERPUTUS,
    Cells,
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
from app.engine.graph import build_graph, route_nodes


def P(**kw):
    base = dict(delay_min=0, arrival_min=20, mode="jalan_kaki", speed_ms=1.0, night=False, night_factor=0.75, buffer_min=2)
    base.update(kw)
    return Params(**base)


def cells_at(points, pops=None, kel=None, graph=None):
    pts = np.array(points, dtype=float)
    node, snap = graph.snap(pts)
    n = len(pts)
    return Cells(
        ids=np.arange(n),
        xy=pts,
        pop=np.array(pops if pops is not None else [10.0] * n),
        kel=np.array(kel if kel is not None else ["K1"] * n, dtype=object),
        node=node,
        snap=snap,
    )


def shelters_at(graph, points, caps=None):
    pts = np.array(points, dtype=float)
    node, snap = graph.snap(pts)
    k = len(pts)
    return Shelters(
        ids=np.array([f"T{j}" for j in range(k)], dtype=object),
        xy=pts,
        node=node,
        snap=snap,
        capacity=np.array(caps if caps is not None else [np.nan] * k, dtype=float),
    )


def line_graph():
    # 0 --100-- 1 --100-- 2 --100-- 3
    return build_graph([("a", [(0, 0), (100, 0)]), ("b", [(100, 0), (200, 0)]), ("c", [(200, 0), (300, 0)])])


def test_garis_lurus():
    g = line_graph()
    assert g.n_nodes == 4 and g.n_edges == 3
    sh = shelters_at(g, [(300, 0)])
    c = cells_at([(0, 0), (100, 0), (200, 0)], graph=g)
    d = cell_distances(g, c, sh)
    assert np.allclose(d.dist, [300, 200, 100], atol=1e-3)
    assert list(d.shelter) == [0, 0, 0]


def test_percabangan_memilih_jalur_terpendek():
    # Dua jalur dari A ke T: langsung 500 m, atau lewat cabang 300 m.
    g = build_graph(
        [
            ("long", [(0, 0), (500, 0)]),
            ("s1", [(0, 0), (150, 100)]),
            ("s2", [(150, 100), (500, 0)]),
        ]
    )
    sh = shelters_at(g, [(500, 0)])
    c = cells_at([(0, 0)], graph=g)
    d = cell_distances(g, c, sh)
    expected = np.hypot(150, 100) + np.hypot(350, 100)
    assert d.dist[0] == pytest.approx(min(500, expected), abs=1e-3)


def test_simpul_terputus():
    g = build_graph([("a", [(0, 0), (100, 0)]), ("island", [(1000, 0), (1100, 0)])])
    sh = shelters_at(g, [(0, 0)])
    c = cells_at([(1000, 0), (50000, 0)], graph=g)
    d = cell_distances(g, c, sh)
    assert not np.isfinite(d.dist[0])  # komponen lain
    assert not np.isfinite(d.dist[1])  # > 200 m dari jalan
    _, _, cls = classify(d.dist, P())
    assert list(cls) == [TERPUTUS, TERPUTUS]


def test_dua_tes_memilih_terdekat():
    g = line_graph()
    sh = shelters_at(g, [(0, 0), (300, 0)])
    c = cells_at([(100, 0), (200, 0)], graph=g)
    d = cell_distances(g, c, sh)
    assert list(d.shelter) == [0, 1]
    assert np.allclose(d.dist, [100, 100], atol=1e-3)


def test_rumus_sisa_waktu_dan_kelas():
    dist = np.array([600.0, 1020.0, 1500.0, np.inf])
    # v = 1 m/s -> t = 10, 17, 25 menit; T_a=20, tau=0, b=2
    t, m, cls = classify(dist, P())
    assert np.allclose(t[:3], [10, 17, 25])
    assert np.allclose(m[:3], [10, 3, -5])
    assert list(cls) == [CUKUP, CUKUP, TERLAMBAT, TERPUTUS]
    _, m2, cls2 = classify(np.array([1140.0]), P())  # m = 1 -> rawan
    assert cls2[0] == RAWAN and m2[0] == pytest.approx(1)


def test_faktor_malam_menurunkan_kecepatan():
    p = P(night=True, night_factor=0.5)
    t, _, _ = classify(np.array([600.0]), p)
    assert t[0] == pytest.approx(20)


def test_ruas_diblokir_memperpanjang_jarak():
    g = build_graph(
        [("direct", [(0, 0), (100, 0)]), ("d1", [(0, 0), (0, 100)]), ("d2", [(0, 100), (100, 100)]), ("d3", [(100, 100), (100, 0)])]
    )
    sh = shelters_at(g, [(100, 0)])
    c = cells_at([(0, 0)], graph=g)
    assert cell_distances(g, c, sh).dist[0] == pytest.approx(100, abs=1e-3)
    assert cell_distances(g, c, sh, blocked={"direct"}).dist[0] == pytest.approx(300, abs=1e-3)


def test_rute_dapat_direkonstruksi():
    g = line_graph()
    sh = shelters_at(g, [(300, 0)])
    c = cells_at([(0, 0)], graph=g)
    d = cell_distances(g, c, sh)
    path = route_nodes(d.nearest, int(c.node[0]))
    assert [tuple(g.xy[i]) for i in path] == [(0, 0), (100, 0), (200, 0), (300, 0)]


def test_agregasi_ik_dan_beban():
    g = line_graph()
    sh = shelters_at(g, [(0, 0)], caps=[15])
    c = cells_at([(0, 0), (300, 0)], pops=[10, 30], kel=["K1", "K2"], graph=g)
    d = cell_distances(g, c, sh)
    p = P(arrival_min=3)  # t = 0 dan 5 menit
    _, m, cls = classify(d.dist, p)
    agg = aggregate(c.pop, c.kel, cls, m, {"K1": "KEC", "K2": "KEC"})
    assert agg["K1"]["ik"] == 1.0
    assert agg["K2"]["ik"] == 0.0
    assert agg["KEC"]["ik"] == pytest.approx(0.25)
    assert agg["__total__"]["pop_total"] == 40
    loads = shelter_loads(c.pop, d, sh)
    assert loads[0]["load"] == pytest.approx(40 / 15)


def test_prioritas_aturan_1_dan_2():
    g = line_graph()
    sh = shelters_at(g, [(0, 0)], caps=[1000])
    c = cells_at([(300, 0), (100, 0)], pops=[10, 10], kel=["JAUH", "DEKAT"], graph=g)
    d = cell_distances(g, c, sh)
    # jauh: t = 5 menit, dekat: t ~ 1.67 menit. T_a = 4, tau = 3.
    p = P(arrival_min=4, delay_min=3, buffer_min=0)
    loads = shelter_loads(c.pop, d, sh)
    items = {i["area_code"]: i for i in priorities(c.pop, c.kel, d, p, loads, sh)}
    assert items["JAUH"]["category"] == "tambah_tes"
    assert items["DEKAT"]["category"] == "percepat_respons"


def test_deterministik_dan_monte_carlo_berbenih():
    g = line_graph()
    sh = shelters_at(g, [(0, 0)])
    c = cells_at([(100, 0), (300, 0)], graph=g)
    d1 = cell_distances(g, c, sh)
    d2 = cell_distances(g, c, sh)
    assert np.array_equal(d1.dist, d2.dist)
    tri = {"delay": (0, 5, 10), "arrival": (10, 20, 35), "speed": (0.8, 1.09, 1.4)}
    a = monte_carlo(d1.dist, c.pop, c.kel, {"K1": "KEC"}, P(), tri, 200, seed=42)
    b = monte_carlo(d1.dist, c.pop, c.kel, {"K1": "KEC"}, P(), tri, 200, seed=42)
    assert a == b
    assert a["K1"]["ik_p5"] <= a["K1"]["ik_p50"] <= a["K1"]["ik_p95"]


def test_matriks_12_kombinasi():
    assert len(matrix_variants(P())) == 12


# --- Uji properti: 1.000 kasus acak -------------------------------------------------


def random_grid(rng, n=6):
    segs = []
    for i in range(n):
        for j in range(n):
            if i + 1 < n and rng.random() > 0.15:
                segs.append((f"h{i}_{j}", [(i * 100.0, j * 100.0), ((i + 1) * 100.0, j * 100.0)]))
            if j + 1 < n and rng.random() > 0.15:
                segs.append((f"v{i}_{j}", [(i * 100.0, j * 100.0), (i * 100.0, (j + 1) * 100.0)]))
    return segs


@pytest.mark.parametrize("seed", range(1000))
def test_properti_acak(seed):
    rng = np.random.default_rng(seed)
    segs = random_grid(rng)
    g = build_graph(segs)
    pts = rng.uniform(0, 500, size=(8, 2))
    c = cells_at(pts, pops=rng.integers(1, 50, 8).astype(float), graph=g)
    sh = shelters_at(g, rng.uniform(0, 500, size=(2, 2)))
    d = cell_distances(g, c, sh)
    p = P(arrival_min=float(rng.uniform(3, 15)), delay_min=float(rng.uniform(0, 5)))

    # Sisa waktu turun ketika tau naik.
    _, m1, _ = classify(d.dist, p)
    _, m2, _ = classify(d.dist, p, delay=p.delay_min + 1)
    fin = np.isfinite(d.dist)
    assert np.all(m2[fin] < m1[fin])

    # IK tidak turun ketika TES ditambah.
    sh2 = shelters_at(g, np.vstack([sh.xy, rng.uniform(0, 500, size=(1, 2))]))
    d2 = cell_distances(g, c, sh2)
    assert np.all(d2.dist <= d.dist + 1e-6)
    _, mA, clsA = classify(d.dist, p)
    _, mB, clsB = classify(d2.dist, p)
    ikA = aggregate(c.pop, c.kel, clsA, mA, {})["__total__"]["ik"]
    ikB = aggregate(c.pop, c.kel, clsB, mB, {})["__total__"]["ik"]
    assert ikB >= ikA - 1e-12

    # Ruas diblokir tidak memperpendek jarak.
    blocked = {segs[int(rng.integers(len(segs)))][0]}
    d3 = cell_distances(g, c, sh, blocked=blocked)
    assert np.all(d3.dist >= d.dist - 1e-6)
