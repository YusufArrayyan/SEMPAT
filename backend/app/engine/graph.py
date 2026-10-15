"""Graf jalan dan Dijkstra multi-sumber.

Semua ruas dianggap dua arah (batasan versi 1.0). Indeks simpul stabil terhadap
pemblokiran ruas: ruas yang diblokir hanya menghapus sisi, bukan simpul, sehingga
pengaitan sel ke simpul dapat dipakai ulang.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

SNAP_TOLERANCE_M = 0.5
EPS = 1e-6


@dataclass
class RoadGraph:
    xy: np.ndarray  # (n, 2) koordinat simpul, meter
    edges: np.ndarray  # (m, 2) indeks simpul, a < b, unik
    lengths: np.ndarray  # (m,) meter
    edge_segment: np.ndarray  # (m,) id ruas asal (string)
    _tree: cKDTree | None = field(default=None, repr=False)

    @property
    def n_nodes(self) -> int:
        return len(self.xy)

    @property
    def n_edges(self) -> int:
        return len(self.edges)

    @property
    def tree(self) -> cKDTree:
        if self._tree is None:
            self._tree = cKDTree(self.xy) if len(self.xy) else cKDTree(np.zeros((1, 2)))
        return self._tree

    def components(self, blocked: set[str] | None = None) -> tuple[int, np.ndarray]:
        mask = self.edge_mask(blocked)
        e = self.edges[mask]
        n = self.n_nodes
        if n == 0:
            return 0, np.zeros(0, dtype=int)
        g = csr_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
        return connected_components(g, directed=False)

    def edge_mask(self, blocked: set[str] | None) -> np.ndarray:
        if not blocked:
            return np.ones(self.n_edges, dtype=bool)
        return ~np.isin(self.edge_segment, list(blocked))

    def snap(self, pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Simpul terdekat (garis lurus) untuk setiap titik."""
        if len(pts) == 0:
            return np.zeros(0, dtype=int), np.zeros(0)
        d, idx = self.tree.query(pts)
        return idx.astype(int), d


def build_graph(segments: list[tuple[str, list[tuple[float, float]]]]) -> RoadGraph:
    """segments: (id_ruas, [(x, y), ...]) dalam meter."""
    key_to_node: dict[tuple[int, int], int] = {}
    xy: list[tuple[float, float]] = []

    def node_for(x: float, y: float) -> int:
        k = (round(x / SNAP_TOLERANCE_M), round(y / SNAP_TOLERANCE_M))
        idx = key_to_node.get(k)
        if idx is None:
            idx = len(xy)
            key_to_node[k] = idx
            xy.append((x, y))
        return idx

    best: dict[tuple[int, int], tuple[float, str]] = {}
    for seg_id, coords in segments:
        prev = None
        for x, y in coords:
            cur = node_for(x, y)
            if prev is not None and prev != cur:
                a, b = (prev, cur) if prev < cur else (cur, prev)
                length = float(np.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]))
                old = best.get((a, b))
                # Sisi ganda: simpan yang terpendek; urutan deterministik lewat id.
                if old is None or (length, seg_id) < old:
                    best[(a, b)] = (length, seg_id)
            prev = cur

    keys = sorted(best)
    edges = np.array(keys, dtype=int).reshape(-1, 2)
    lengths = np.array([best[k][0] for k in keys], dtype=float)
    edge_segment = np.array([best[k][1] for k in keys], dtype=object)
    return RoadGraph(np.array(xy, dtype=float).reshape(-1, 2), edges, lengths, edge_segment)


@dataclass
class NearestResult:
    dist: np.ndarray  # (n,) jarak jaringan simpul -> TES terdekat (termasuk jarak kait TES)
    source: np.ndarray  # (n,) indeks TES (posisi dalam daftar), -1 bila tak terjangkau
    pred: np.ndarray  # (n + k,) pendahulu untuk rekonstruksi rute
    n_nodes: int


def nearest_shelter(
    graph: RoadGraph,
    shelter_nodes: np.ndarray,
    shelter_offsets: np.ndarray,
    blocked: set[str] | None = None,
) -> NearestResult:
    """Satu pencarian Dijkstra multi-sumber dari semua TES sah.

    Setiap TES menjadi simpul maya yang terhubung ke simpul jalan terdekatnya dengan
    bobot jarak kait. Karena semua ruas dua arah, jarak dari TES ke simpul sama dengan
    jarak dari simpul ke TES.
    """
    n = graph.n_nodes
    k = len(shelter_nodes)
    if k == 0 or n == 0:
        return NearestResult(np.full(n, np.inf), np.full(n, -1), np.full(n + k, -9999), n)

    mask = graph.edge_mask(blocked)
    e = graph.edges[mask]
    w = graph.lengths[mask] + EPS
    virt = n + np.arange(k)
    rows = np.concatenate([e[:, 0], e[:, 1], virt])
    cols = np.concatenate([e[:, 1], e[:, 0], shelter_nodes])
    wts = np.concatenate([w, w, shelter_offsets + EPS])
    g = csr_matrix((wts, (rows, cols)), shape=(n + k, n + k))
    dist, pred, src = dijkstra(g, directed=True, indices=virt, min_only=True, return_predecessors=True)
    source = np.where(src[:n] >= n, src[:n] - n, -1)
    d = dist[:n]
    d = np.where(np.isfinite(d), d, np.inf)
    return NearestResult(d, source.astype(int), pred, n)


def route_nodes(res: NearestResult, start_node: int) -> list[int]:
    """Urutan simpul dari simpul awal sampai simpul jalan tempat TES terkait."""
    if not np.isfinite(res.dist[start_node]):
        return []
    path = [start_node]
    cur = start_node
    guard = 0
    while True:
        p = int(res.pred[cur])
        if p < 0 or p >= res.n_nodes:
            break
        path.append(p)
        cur = p
        guard += 1
        if guard > res.n_nodes:
            break
    return path
