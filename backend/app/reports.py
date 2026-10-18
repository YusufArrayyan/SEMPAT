"""Ekspor laporan PDF (2-4 halaman), CSV, dan GeoJSON (FR-19).

PDF dibuat dengan ReportLab agar berjalan tanpa pustaka sistem (GTK) di Windows maupun
kontainer. Teks PDF memakai ASCII agar aman pada fon bawaan.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path
from datetime import datetime, timedelta, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image as RLImage
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import PUBLIC_MIN_CELL_POP
from .models import Area, AreaResult, CellResult, Dataset, PopulationCell, PriorityItem, Run, Scenario, ShelterResult

WIB = timezone(timedelta(hours=7))
LOGO_PATH = Path(__file__).with_name("sempat-logo.png")
DISCLAIMER = "Hasil ini adalah uji kecukupan tempat evakuasi pada skenario terpilih, bukan prediksi tsunami."
CLASS_LABEL = {"cukup": "Cukup", "rawan": "Rawan", "terlambat": "Terlambat", "terputus": "Terputus"}
CLASS_COLOR = {"cukup": "#009e73", "rawan": "#f0e442", "terlambat": "#882255", "terputus": "#8c8c8c"}
CATEGORY_LABEL = {"tambah_tes": "Tambah atau pindahkan TES", "percepat_respons": "Percepat respons (sirene, latihan, rambu)"}
FLAG_LABEL = {
    "perbaiki_rute": "Perbaiki atau tambah rute",
    "penerangan": "Penerangan jalur evakuasi",
    "perluas_kapasitas": "Perluas kapasitas atau pecah beban",
}
MODE_LABEL = {"jalan_kaki": "Jalan kaki", "kendaraan": "Kendaraan"}


def fmt_int(v) -> str:
    return f"{v:,.0f}".replace(",", ".") if v is not None else "-"


def fmt_pct(v) -> str:
    return f"{v * 100:.1f}%".replace(".", ",") if v is not None else "-"


def fmt_num(v, d=1) -> str:
    return f"{v:.{d}f}".replace(".", ",") if v is not None else "-"


def ascii_safe(s: str) -> str:
    return (
        s.replace("→", "->").replace("≥", ">=").replace("≤", "<=").replace("τ", "tau").replace("–", "-").replace("—", "-").replace("…", "...")
    )


def _context(db: Session, run: Run):
    sc = db.get(Scenario, run.scenario_id)
    ds = db.get(Dataset, run.dataset_id)
    areas = {a.code: a for a in db.scalars(select(Area).where(Area.dataset_id == run.dataset_id))}
    return sc, ds, areas


def area_rows(db: Session, run: Run, variant: str = "") -> list[AreaResult]:
    return list(db.scalars(select(AreaResult).where(AreaResult.run_id == run.id, AreaResult.variant == variant)))


# --- CSV ----------------------------------------------------------------------------------


def export_csv_areas(db: Session, run: Run) -> str:
    _, ds, areas = _context(db, run)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["run_id", "versi_dataset", "varian", "tingkat", "kode", "nama", "kode_induk", "ik", "ik_p5", "ik_p50", "ik_p95", "penduduk_terdampak", "penduduk_cukup", "penduduk_rawan", "penduduk_terlambat", "penduduk_terputus", "rerata_defisit_menit"])
    rows = db.scalars(select(AreaResult).where(AreaResult.run_id == run.id).order_by(AreaResult.variant, AreaResult.level, AreaResult.area_code))
    for r in rows:
        a = areas.get(r.area_code)
        w.writerow(
            [
                run.id,
                f"{ds.name} v{ds.version}",
                r.variant or "dasar",
                r.level,
                r.area_code if r.area_code != "__total__" else "KOTA",
                a.name if a else "Kota Bengkulu (total)",
                a.parent_code if a else "",
                "" if r.ik is None else round(r.ik, 6),
                "" if r.ik_p5 is None else round(r.ik_p5, 6),
                "" if r.ik_p50 is None else round(r.ik_p50, 6),
                "" if r.ik_p95 is None else round(r.ik_p95, 6),
                round(r.pop_total, 2),
                round(r.pop_cukup, 2),
                round(r.pop_rawan, 2),
                round(r.pop_late, 2),
                round(r.pop_terputus, 2),
                round(r.mean_deficit, 3),
            ]
        )
    return buf.getvalue()


def export_csv_cells(db: Session, run: Run) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["cell_id", "kode_kelurahan", "lon", "lat", "penduduk", "kelas", "jarak_m", "waktu_tempuh_menit", "sisa_waktu_menit", "tes_id"])
    q = (
        select(CellResult, PopulationCell)
        .join(PopulationCell, PopulationCell.id == CellResult.cell_id)
        .where(CellResult.run_id == run.id)
        .order_by(CellResult.cell_id)
    )
    for cr, pc in db.execute(q):
        w.writerow([cr.cell_id, pc.area_code, round(pc.lon, 6), round(pc.lat, 6), round(pc.population, 3), cr.cls, _r(cr.dist_m, 1), _r(cr.time_min, 3), _r(cr.margin_min, 3), cr.shelter_id or ""])
    return buf.getvalue()


def _r(v, d):
    return "" if v is None else round(v, d)


# --- GeoJSON ------------------------------------------------------------------------------


def cells_geojson(db: Session, run: Run, public: bool = False) -> dict:
    from .engine.geo import points_to_lonlat
    import numpy as np

    q = select(CellResult, PopulationCell).join(PopulationCell, PopulationCell.id == CellResult.cell_id).where(CellResult.run_id == run.id)
    rows = list(db.execute(q))
    half = 50.0
    feats = []
    if rows:
        xy = np.array([[pc.x, pc.y] for _, pc in rows])
        corners = []
        for dx, dy in ((-half, -half), (half, -half), (half, half), (-half, half)):
            corners.append(points_to_lonlat(xy + np.array([dx, dy])))
        for i, (cr, pc) in enumerate(rows):
            hidden = public and pc.population < PUBLIC_MIN_CELL_POP
            ring = [[round(float(corners[k][i, 0]), 6), round(float(corners[k][i, 1]), 6)] for k in range(4)]
            ring.append(ring[0])
            if hidden:
                # Hanya lokasi; kelas dan angka disembunyikan (privasi tampilan publik).
                feats.append({"type": "Feature", "id": cr.cell_id, "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"id": cr.cell_id, "kelas": "disembunyikan"}})
                continue
            props = {
                "id": cr.cell_id,
                "kelas": cr.cls,
                "sisa_menit": None if cr.margin_min is None else round(cr.margin_min, 2),
                "kel": pc.area_code,
            }
            if not public:
                props.update(
                    {
                        "penduduk": round(pc.population, 1),
                        "jarak_m": None if cr.dist_m is None else round(cr.dist_m, 1),
                        "waktu_menit": None if cr.time_min is None else round(cr.time_min, 2),
                        "tes": cr.shelter_id,
                    }
                )
            feats.append({"type": "Feature", "id": cr.cell_id, "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props})
    return {"type": "FeatureCollection", "features": feats}


# --- PDF ----------------------------------------------------------------------------------

INK = colors.HexColor("#161616")
MUTED = colors.HexColor("#525252")
HAIR = colors.HexColor("#e0e0e0")
SURF = colors.HexColor("#f4f4f4")
BLUE = colors.HexColor("#0f62fe")

S_TITLE = ParagraphStyle("t", fontName="Helvetica", fontSize=20, leading=24, textColor=INK, spaceAfter=4)
S_H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=INK, spaceBefore=10, spaceAfter=6)
S_BODY = ParagraphStyle("b", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
S_MUTED = ParagraphStyle("m", fontName="Helvetica", fontSize=8, leading=10.5, textColor=MUTED)
S_NOTE = ParagraphStyle("n", parent=S_BODY, backColor=SURF, borderPadding=6, spaceBefore=4, spaceAfter=8)


def _p(text: str, style=S_BODY):
    return Paragraph(ascii_safe(text), style)


def _table(data, widths, header=True, align_right_from=None):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, HAIR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        st += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("BACKGROUND", (0, 0), (-1, 0), SURF), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    if align_right_from is not None:
        st.append(("ALIGN", (align_right_from, 0), (-1, -1), "RIGHT"))
    t.setStyle(TableStyle(st))
    return t


def _map_drawing(db: Session, run: Run, public: bool, width=170 * mm, height=95 * mm) -> Drawing:
    q = select(CellResult.cls, PopulationCell.x, PopulationCell.y, PopulationCell.population).join(PopulationCell, PopulationCell.id == CellResult.cell_id).where(CellResult.run_id == run.id)
    rows = [r for r in db.execute(q) if not (public and r.population < PUBLIC_MIN_CELL_POP)]
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=colors.HexColor("#eef3f8"), strokeColor=HAIR))
    if not rows:
        return d
    xs = [r.x for r in rows]
    ys = [r.y for r in rows]
    minx, maxx, miny, maxy = min(xs) - 100, max(xs) + 100, min(ys) - 100, max(ys) + 100
    legend_w = 34 * mm
    s = min((width - legend_w - 8) / (maxx - minx), (height - 8) / (maxy - miny))
    ox = 4 + ((width - legend_w - 8) - (maxx - minx) * s) / 2
    oy = 4 + ((height - 8) - (maxy - miny) * s) / 2
    cs = max(100 * s, 0.6)
    for r in rows:
        d.add(Rect(ox + (r.x - 50 - minx) * s, oy + (r.y - 50 - miny) * s, cs, cs, fillColor=colors.HexColor(CLASS_COLOR[r.cls]), strokeColor=None))
    lx = width - legend_w + 4
    ly = height - 14
    d.add(String(lx, ly + 2, "Kelas sisa waktu", fontName="Helvetica-Bold", fontSize=7, fillColor=INK))
    for i, k in enumerate(["cukup", "rawan", "terlambat", "terputus"]):
        y = ly - 12 - i * 11
        d.add(Rect(lx, y, 8, 8, fillColor=colors.HexColor(CLASS_COLOR[k]), strokeColor=INK, strokeWidth=0.3))
        d.add(String(lx + 12, y + 1, CLASS_LABEL[k], fontName="Helvetica", fontSize=7, fillColor=INK))
    # skala 1 km
    bar = 1000 * s
    d.add(Line(lx, 10, lx + bar, 10, strokeColor=INK, strokeWidth=1))
    d.add(String(lx, 14, "1 km", fontName="Helvetica", fontSize=6.5, fillColor=INK))
    return d


def export_pdf(db: Session, run: Run, public: bool = False) -> bytes:
    sc, ds, areas = _context(db, run)
    p = run.params
    s = run.summary or {}
    buf = io.BytesIO()
    created = datetime.now(WIB).strftime("%d-%m-%Y %H:%M WIB")

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 10 * mm, ascii_safe(f"Sempat v1.0 - Run {run.id[:8]} - {DISCLAIMER}"))
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Halaman {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title="Laporan Sempat", author="Sempat")
    story = []
    logo = RLImage(str(LOGO_PATH), width=14 * mm, height=14 * mm)
    title = _p("Laporan uji kecukupan TES" + (" - ringkasan publik" if public else ""), S_TITLE)
    head = Table([[logo, title]], colWidths=[18 * mm, None])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story.append(head)
    story.append(_p(f"Kota Bengkulu - skenario <b>{sc.name}</b> - dibuat {created}", S_MUTED))
    story.append(_p(f"<b>Penafian.</b> {DISCLAIMER} Parameter di bawah adalah masukan, bukan hasil temuan; beberapa masih perlu kalibrasi bersama BPBD.", S_NOTE))

    eff_delay = s.get("effective_delay_min", p["delay_min"])
    param_rows = [
        ["Parameter", "Nilai", "Parameter", "Nilai"],
        ["Jeda respons (tau)", f"{fmt_num(eff_delay, 1)} menit", "Waktu tiba gelombang (T_a)", f"{fmt_num(p['arrival_min'], 1)} menit"],
        ["Moda", MODE_LABEL.get(p["mode"], p["mode"]), "Kecepatan moda", f"{fmt_num(p['speed_ms'], 2)} m/detik"],
        ["Kondisi malam", f"Ya (f = {fmt_num(p['night_factor'], 2)})" if p["night"] else "Tidak", "Kecepatan efektif", f"{fmt_num(s.get('velocity_ms'), 2)} m/detik"],
        ["Margin pengaman (b)", f"{fmt_num(p['buffer_min'], 1)} menit", "Jenis run", {"tunggal": "Tunggal", "matriks": "Matriks 12", "monte_carlo": "Monte Carlo"}.get(run.kind, run.kind)],
        ["Intervensi", f"{len(run.interventions)} diterapkan" if run.with_interventions else "Tidak ada", "Ukuran sel", "100 m x 100 m"],
    ]
    story.append(_p("Parameter skenario", S_H2))
    story.append(_table(param_rows, [38 * mm, 47 * mm, 42 * mm, 47 * mm]))
    story.append(_p("Ketertelusuran", S_H2))
    trace = [
        ["Versi dataset", f"{ds.name} v{ds.version} (hash {(ds.checksum or '')[:16]})"],
        ["Sumber dan lisensi", f"{(ds.source or '-').rstrip('.')}; {ds.license or '-'}; diakses {ds.accessed_at or '-'}"],
        ["Versi mesin hitung", run.engine_version],
        ["Hash masukan", run.input_hash],
        ["Benih acak", str(run.seed) if run.seed is not None else "-"],
        ["Selesai dihitung", (run.finished_at if run.finished_at.tzinfo else run.finished_at.replace(tzinfo=timezone.utc)).astimezone(WIB).strftime("%d-%m-%Y %H:%M WIB") if run.finished_at else "-"],
    ]
    if not public:
        trace.append(["ID Run", run.id])
    story.append(_table([[k, _p(v, S_BODY)] for k, v in trace], [38 * mm, 136 * mm], header=False))

    story.append(_p("Hasil ringkas", S_H2))
    story.append(
        _p(
            f"Indeks kecukupan kota <b>{fmt_pct(s.get('ik'))}</b>: dari {fmt_int(s.get('pop_total'))} penduduk di zona genangan, "
            f"{fmt_int(s.get('pop_late'))} jiwa Terlambat dan {fmt_int(s.get('pop_terputus'))} jiwa Terputus "
            f"(tau {fmt_num(eff_delay, 0)} mnt, T_a {fmt_num(p['arrival_min'], 0)} mnt, {MODE_LABEL.get(p['mode'])}).",
        )
    )
    if s.get("mc"):
        mc = s["mc"]
        story.append(_p(f"Monte Carlo: median IK {fmt_pct(mc['ik_p50'])}, rentang P5-P95 {fmt_pct(mc['ik_p5'])} - {fmt_pct(mc['ik_p95'])}.", S_BODY))
    story.append(Spacer(1, 4))
    story.append(_map_drawing(db, run, public))
    story.append(_p("Peta: kelas sisa waktu per sel 100 m. Warna disertai label pada legenda; padanan tabel ada di halaman berikut." + (" Sel berpenduduk < 10 jiwa disembunyikan." if public else ""), S_MUTED))

    story.append(PageBreak())
    story.append(_p("Indeks kecukupan per kecamatan", S_H2))
    rows = sorted([r for r in area_rows(db, run) if r.level == "kecamatan"], key=lambda r: (r.ik if r.ik is not None else 2))
    has_mc = any(r.ik_p50 is not None for r in rows)
    head = ["Kecamatan", "IK", "Terdampak", "Cukup", "Rawan", "Terlambat", "Terputus"] + (["P5-P95"] if has_mc else [])
    data = [head]
    for r in rows:
        a = areas.get(r.area_code)
        row = [a.name if a else r.area_code, fmt_pct(r.ik), fmt_int(r.pop_total), fmt_int(r.pop_cukup), fmt_int(r.pop_rawan), fmt_int(r.pop_late), fmt_int(r.pop_terputus)]
        if has_mc:
            row.append(f"{fmt_pct(r.ik_p5)}-{fmt_pct(r.ik_p95)}")
        data.append(row)
    total = next((r for r in area_rows(db, run) if r.level == "kota"), None)
    if total:
        data.append(["Total kota", fmt_pct(total.ik), fmt_int(total.pop_total), fmt_int(total.pop_cukup), fmt_int(total.pop_rawan), fmt_int(total.pop_late), fmt_int(total.pop_terputus)] + ([""] if has_mc else []))
    w = [44 * mm, 18 * mm, 22 * mm, 20 * mm, 20 * mm, 22 * mm, 20 * mm] + ([26 * mm] if has_mc else [])
    if has_mc:
        w = [36 * mm, 15 * mm, 20 * mm, 18 * mm, 17 * mm, 20 * mm, 18 * mm, 30 * mm]
    story.append(_table(data, w, align_right_from=1))

    story.append(_p("Daftar prioritas kelurahan", S_H2))
    pri = list(db.scalars(select(PriorityItem).where(PriorityItem.run_id == run.id).order_by(PriorityItem.rank)))
    if not pri:
        story.append(_p("Tidak ada kelurahan dengan penduduk Terlambat pada skenario ini."))
    else:
        data = [["#", "Kelurahan", "Terlambat", "Defisit", "Rekomendasi utama dan penanda"]]
        limit = 12 if public else 25
        for it in pri[:limit]:
            a = areas.get(it.area_code)
            rec = CATEGORY_LABEL.get(it.category, it.category)
            if it.flags:
                rec += " | " + "; ".join(FLAG_LABEL.get(f, f) for f in it.flags)
            data.append([str(it.rank), _p(a.name if a else it.area_code), fmt_int(it.pop_late), f"{fmt_num(it.mean_deficit, 1)} mnt", _p(rec)])
        story.append(_table(data, [8 * mm, 40 * mm, 20 * mm, 18 * mm, 88 * mm], align_right_from=None))
        if len(pri) > limit:
            story.append(_p(f"{len(pri) - limit} kelurahan lain tercantum pada ekspor CSV.", S_MUTED))

    if not public:
        story.append(PageBreak())
        story.append(_p("Beban TES", S_H2))
        loads = sorted(db.scalars(select(ShelterResult).where(ShelterResult.run_id == run.id)), key=lambda r: -(r.load or -1))
        data = [["TES", "Tipe", "Penduduk ditugaskan", "Kapasitas", "Beban B"]]
        for l in loads:
            data.append(
                [
                    _p(l.name + (" (hipotetis)" if l.hypothetical else "")),
                    l.type.replace("_", " "),
                    fmt_int(l.assigned_pop),
                    fmt_int(l.capacity) if l.capacity else "belum diketahui",
                    (fmt_num(l.load, 2) + (" (lebih)" if l.load > 1 else "")) if l.load is not None else "kapasitas belum diketahui",
                ]
            )
        story.append(_table(data, [62 * mm, 26 * mm, 30 * mm, 24 * mm, 32 * mm], align_right_from=2))

    story.append(
        KeepTogether(
            [
                _p("Batasan", S_H2),
                _p(
                    "Penugasan memakai TES terdekat lewat jaringan, bukan pembagian beban optimal; kapasitas dilaporkan terpisah sebagai beban B. "
                    "Semua ruas dianggap dua arah; kemiringan, kondisi permukaan, dan kemacetan tidak dimodelkan. Satu sel diwakili satu titik dan penduduk "
                    "dalam sel dianggap seragam. Kecepatan, jeda respons, faktor malam, dan margin pengaman adalah nilai awal yang perlu dikalibrasi. "
                    "Hanya sel permukiman di dalam zona genangan yang dihitung."
                ),
            ]
        )
    )
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
