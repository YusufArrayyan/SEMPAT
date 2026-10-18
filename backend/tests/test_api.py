"""Uji alur API ujung ke ujung pada data contoh sintetis."""

import os
import tempfile
import time

import pytest

os.environ.setdefault("SEMPAT_DATA_DIR", tempfile.mkdtemp(prefix="sempat_test_"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(c, who="analis"):
    r = c.post("/api/auth/login", json={"email": f"{who}@sempat.local", "password": f"sempat-{who}-2026"})
    assert r.status_code == 200, r.text
    return r


def wait(c, run_id, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = c.get(f"/api/runs/{run_id}").json()
        if r["status"] in ("selesai", "gagal", "dibatalkan"):
            return r
        time.sleep(0.3)
    raise AssertionError("run tidak selesai")


def test_login_salah(client):
    r = client.post("/api/auth/login", json={"email": "analis@sempat.local", "password": "salah"})
    assert r.status_code == 401
    assert r.json()["error"]["hint"]


def test_alur_utama(client):
    login(client)
    ds = client.get("/api/datasets").json()["items"]
    assert ds and ds[0]["status"] == "terbit", ds
    sc = client.get("/api/scenarios").json()["items"]
    assert len(sc) >= 2
    sid = sc[0]["id"]

    run = client.post(f"/api/scenarios/{sid}/runs", json={"kind": "tunggal"})
    assert run.status_code == 202
    done = wait(client, run.json()["id"])
    assert done["status"] == "selesai", done
    s = done["summary"]
    assert 0 <= s["ik"] <= 1
    assert done["duration_s"] < 30  # NFR-01

    rid = done["id"]
    areas = client.get(f"/api/runs/{rid}/areas").json()["items"]
    kota = next(a for a in areas if a["level"] == "kota")
    kec_sum = sum(a["pop_total"] for a in areas if a["level"] == "kecamatan")
    assert abs(kec_sum - kota["pop_total"]) < 1e-6  # FR-15

    cells = client.get(f"/api/runs/{rid}/cells").json()
    assert cells["features"]
    cid = next(f["id"] for f in cells["features"] if f["properties"]["kelas"] != "terputus")
    detail = client.get(f"/api/runs/{rid}/cells/{cid}").json()
    assert detail["route"]["geometry"]["coordinates"]
    exported = next(f for f in cells["features"] if f["id"] == cid)["properties"]
    assert abs(detail["dist_m"] - exported["jarak_m"]) < 0.1  # FR-14

    # Reproduksibilitas: ulang hitung identik
    run2 = wait(client, client.post(f"/api/scenarios/{sid}/runs", json={"kind": "tunggal"}).json()["id"])
    assert run2["input_hash"] == done["input_hash"]
    assert run2["summary"]["ik"] == s["ik"] and run2["summary"]["pop_late"] == s["pop_late"]

    pri = client.get(f"/api/runs/{rid}/priorities").json()["items"]
    for p in pri:
        assert p["category"] in ("tambah_tes", "percepat_respons")
        assert p["rationale"]

    pdf = client.post(f"/api/runs/{rid}/reports", json={"format": "pdf"}).json()
    body = client.get(pdf["url"]).content
    assert body[:4] == b"%PDF"

    share = client.post(f"/api/runs/{rid}/share").json()
    client.post("/api/auth/logout")
    pub = client.get(f"/api/public/{share['token']}")
    assert pub.status_code == 200
    pc = client.get(f"/api/public/{share['token']}/cells").json()
    assert all("penduduk" not in f["properties"] for f in pc["features"])
    assert all(set(f["properties"]) == {"id", "kelas"} for f in pc["features"] if f["properties"]["kelas"] == "disembunyikan")
    assert client.get(f"/api/runs/{rid}").status_code == 401


def test_intervensi_dan_banding(client):
    login(client, "peneliti")
    sid = client.get("/api/scenarios").json()["items"][0]["id"]
    full = client.get(f"/api/scenarios/{sid}").json()
    layers = client.get(f"/api/datasets/{full['dataset_id']}/layers").json()
    minx, miny, maxx, maxy = layers["bounds"]
    r = client.post(
        f"/api/scenarios/{sid}/interventions",
        json={"type": "tambah_tes", "label": "uji", "payload": {"lon": minx + (maxx - minx) * 0.3, "lat": miny + (maxy - miny) * 0.5, "capacity": 2000}},
    )
    assert r.status_code == 201, r.text
    client.post(f"/api/scenarios/{sid}/interventions", json={"type": "kurangi_jeda", "payload": {"minus_min": 3}})
    run = client.post(f"/api/scenarios/{sid}/runs", json={"kind": "tunggal", "with_interventions": True}).json()
    done = wait(client, run["id"])
    base = wait(client, done["base_run_id"])
    assert done["status"] == "selesai" and base["status"] == "selesai"
    cmp = client.get(f"/api/runs/compare?a={base['id']}&b={done['id']}").json()
    assert cmp["moved_sempat_to_late"] == 0
    assert done["summary"]["ik"] >= base["summary"]["ik"]


def test_matriks_dan_monte_carlo(client):
    login(client, "peneliti")
    sid = client.get("/api/scenarios").json()["items"][0]["id"]
    m = wait(client, client.post(f"/api/scenarios/{sid}/matrix").json()["id"])
    assert m["status"] == "selesai"
    mt = client.get(f"/api/runs/{m['id']}/matrix").json()
    assert len(mt["variants"]) == 12
    mc = wait(client, client.post(f"/api/scenarios/{sid}/runs", json={"kind": "monte_carlo"}).json()["id"])
    assert mc["status"] == "selesai" and mc["seed"] is not None
    a = client.get(f"/api/runs/{mc['id']}/areas").json()["items"]
    k = next(x for x in a if x["level"] == "kota")
    assert k["ik_p5"] <= k["ik_p50"] <= k["ik_p95"]


def test_peran_dibatasi(client):
    login(client, "peneliti")
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/audit").status_code == 403


def test_akun_demo(client):
    r = client.post("/api/auth/login", json={"email": "demo.analis@sempat.demo", "password": "DemoAnalis2026"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "analis"
    r = client.post("/api/auth/login", json={"email": "demo.peneliti@sempat.demo", "password": "DemoPeneliti2026"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "peneliti"
    assert client.get("/api/users").status_code == 403
