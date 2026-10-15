# Sempat v1.0

Aplikasi web pendukung keputusan untuk **uji kecukupan tempat evakuasi sementara (TES) tsunami** di Kota Bengkulu, dibangun dari `PRD_Sempat_v1.0.pdf`.

Untuk setiap sel permukiman 100 m di zona genangan, Sempat menghitung sisa waktu

```
m_i = T_a − (τ + d_i / (60 · v))
```

lalu menyusun indeks kecukupan (IK) per kecamatan dan kelurahan, beban TES, dan daftar prioritas intervensi. Sistem ini bukan sistem peringatan dini dan bukan prediktor tsunami.

## Menjalankan

### Docker (satu perintah)

```bash
docker compose up --build
```

Buka http://localhost:8000. Basis data PostgreSQL 16 + PostGIS; data contoh dimuat otomatis pada awal pertama.

### Pengembangan lokal

Backend (Python 3.12+):

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/pip
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Frontend (Node 20+), di terminal lain:

```bash
cd frontend
npm install
npm run dev
```

Buka http://localhost:5173. Vite meneruskan `/api` ke port 8000. Tanpa `DATABASE_URL`, backend memakai SQLite di `backend/var/`.

### Akun awal (hanya pengembangan lokal)

| Peran | Surel | Kata sandi |
|---|---|---|
| Admin | admin@sempat.local | sempat-admin-2026 |
| Analis | analis@sempat.local | sempat-analis-2026 |
| Peneliti | peneliti@sempat.local | sempat-peneliti-2026 |

Ganti lewat variabel `SEMPAT_ADMIN_PASSWORD`, `SEMPAT_ANALIS_PASSWORD`, `SEMPAT_PENELITI_PASSWORD` sebelum akun pertama dibuat, atau ubah dari halaman Admin. Untuk penyebaran HTTPS, setel `SEMPAT_COOKIE_SECURE=1`.

## Data contoh

Saat basis data kosong, backend membuat **data sintetis** berbentuk Kota Bengkulu (`backend/app/sample.py`, benih 2026) dan menerbitkannya: 9 kecamatan, 50 kelurahan, ±4.800 ruas jalan dengan sungai dan tiga jembatan, 27 TES, 6 sirene, dan satu zona genangan. Dua baris TES sengaja salah (dataran tinggi di zona genangan; tipe belum diisi) untuk memperlihatkan laporan validasi.

**Data ini bukan data resmi.** Ganti dengan data BPBD, BPS, InaRISK, dan Ina-Geoportal lewat halaman Data. Berkas contoh tersimpan di `backend/sample_data/` dan dapat dipakai sebagai templat format impor.

## Pengujian

```bash
cd backend && .venv/Scripts/python -m pytest -q        # 1.012 uji mesin + 5 uji alur API
cd frontend && node e2e/smoke.mjs                      # uji asap ujung ke ujung (Edge headless; API dan Vite harus hidup)
```

Uji mesin memuat kasus mainan berjawaban hitung tangan (garis lurus, percabangan, simpul terputus, dua TES) dan 1.000 uji properti acak: sisa waktu turun saat τ naik, IK tidak turun saat TES ditambah, dan ruas diblokir tidak memperpendek jarak.

## Struktur

```
backend/app/engine/   mesin hitung murni: graf, Dijkstra multi-sumber, kelas, IK, beban, prioritas, Monte Carlo
backend/app/          API FastAPI, impor & validasi, kisi 100 m, pekerja asinkron, laporan PDF/CSV/GeoJSON
frontend/src/pages/   layar S1–S12 PRD (Masuk, Dasbor, Data, Skenario, Editor, Hasil, Bandingkan, Metodologi, Admin, Publik)
```

## Penyimpangan dari PRD 6.1

| PRD | Versi ini | Alasan |
|---|---|---|
| Redis + RQ | Kumpulan utas dalam proses (`app/jobs.py`) | Berjalan tanpa layanan tambahan; antarmuka `submit/cancel` siap diganti RQ |
| pg_tileserv | GeoJSON dari API | Cukup untuk ±3.400 sel terdampak; ubin vektor diperlukan bila mendekati 60.000 sel |
| WeasyPrint | ReportLab | WeasyPrint butuh GTK di Windows; ReportLab murni Python |
| Kolom geometri PostGIS | GeoJSON dalam kolom JSON; proyeksi dengan PyProj/Shapely | Kode yang sama berjalan di SQLite dan PostgreSQL |
| GeoPandas | Shapely + PyProj langsung | Ketergantungan lebih ringan |

## Batasan yang perlu diketahui

- Hanya sel permukiman di dalam zona genangan yang dihitung; IK memakai penduduk terdampak sebagai penyebut.
- Peta tidak memakai ubin dasar eksternal; latar laut, batas wilayah, dan jalan digambar dari data sendiri agar berjalan luring.
- Jalur Docker/PostgreSQL ditulis dan divalidasi konfigurasinya, tetapi pengujian otomatis dijalankan pada SQLite.
