"""Proyeksi: simpan di EPSG:4326, hitung di EPSG:32748 (UTM zona 48S)."""

from __future__ import annotations

import numpy as np
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

_FWD = Transformer.from_crs(4326, 32748, always_xy=True)
_INV = Transformer.from_crs(32748, 4326, always_xy=True)


def to_utm(lon, lat):
    return _FWD.transform(lon, lat)


def to_lonlat(x, y):
    return _INV.transform(x, y)


def geom_to_utm(geom):
    return transform(lambda x, y, z=None: _FWD.transform(x, y), geom)


def geom_to_lonlat(geom):
    return transform(lambda x, y, z=None: _INV.transform(x, y), geom)


def geojson_to_utm(geojson_geom: dict):
    return geom_to_utm(shape(geojson_geom))


def points_to_utm(lonlat: np.ndarray) -> np.ndarray:
    if len(lonlat) == 0:
        return np.zeros((0, 2))
    x, y = _FWD.transform(lonlat[:, 0], lonlat[:, 1])
    return np.column_stack([x, y])


def points_to_lonlat(xy: np.ndarray) -> np.ndarray:
    if len(xy) == 0:
        return np.zeros((0, 2))
    lon, lat = _INV.transform(xy[:, 0], xy[:, 1])
    return np.column_stack([lon, lat])
