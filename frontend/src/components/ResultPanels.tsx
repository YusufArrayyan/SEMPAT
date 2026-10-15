import { useMemo, useState } from 'react'
import { CATEGORY_DESC, CATEGORY_LABEL, CLS_DESC, FLAG_LABEL, MODE_LABEL, TYPE_LABEL, dec1, dec2, int, minutes, pct } from '../lib/format'
import type { AreaRow, CellDetail, PriorityRow, ShelterRow } from '../lib/types'
import { ClsLabel, Icon, IkMeter } from './ui'

type SortKey = 'name' | 'ik' | 'pop_total' | 'pop_late' | 'mean_deficit'

export function AreaTable({ rows, level, onLevel, showMc, parentNames }: { rows: AreaRow[]; level: 'kecamatan' | 'kelurahan'; onLevel?: (l: 'kecamatan' | 'kelurahan') => void; showMc: boolean; parentNames?: Record<string, string> }) {
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'ik', asc: true })
  const [filter, setFilter] = useState('')
  const [hideEmpty, setHideEmpty] = useState(true)
  const data = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return rows
      .filter((r) => r.level === level)
      .filter((r) => !hideEmpty || r.pop_total > 0)
      .filter((r) => !f || r.name.toLowerCase().includes(f) || (parentNames?.[r.parent ?? ''] ?? '').toLowerCase().includes(f))
      .sort((a, b) => {
        const av = sort.k === 'name' ? a.name : ((a[sort.k] as number | null) ?? -1)
        const bv = sort.k === 'name' ? b.name : ((b[sort.k] as number | null) ?? -1)
        const c = typeof av === 'string' ? av.localeCompare(bv as string, 'id') : (av as number) - (bv as number)
        return sort.asc ? c : -c
      })
  }, [rows, level, sort, filter, hideEmpty, parentNames])
  const kota = rows.find((r) => r.level === 'kota')
  const totalShown = data.reduce((s, r) => s + r.pop_total, 0)
  const totalAll = rows.filter((r) => r.level === level).reduce((s, r) => s + r.pop_total, 0)

  const th = (k: SortKey, label: string, right = false) => (
    <th className={right ? 'r' : ''} aria-sort={sort.k === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-btn" onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : k === 'name' || k === 'ik' }))}>
        {label}
        <span aria-hidden="true">{sort.k === k ? (sort.asc ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  )

  return (
    <div className="stack stack-8">
      <div className="table-toolbar">
        {onLevel && (
          <>
            <label htmlFor="lvl" className="sr-only">
              Tingkat wilayah
            </label>
            <select id="lvl" className="select" style={{ width: 'auto' }} value={level} onChange={(e) => onLevel(e.target.value as any)}>
              <option value="kecamatan">Kecamatan</option>
              <option value="kelurahan">Kelurahan</option>
            </select>
          </>
        )}
        <label htmlFor="area-f" className="sr-only">
          Saring wilayah
        </label>
        <input id="area-f" className="input" type="search" placeholder="Saring nama…" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
      </div>
      <label className="checkbox caption">
        <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
        Sembunyikan wilayah tanpa penduduk di zona genangan
      </label>
      <div className="table-wrap">
        <table className="dt compact">
          <caption className="sr-only">Indeks kecukupan per {level}; padanan tabel untuk peta</caption>
          <thead>
            <tr>
              {th('name', level === 'kecamatan' ? 'Kecamatan' : 'Kelurahan')}
              {th('ik', 'IK')}
              {th('pop_total', 'Terdampak', true)}
              {th('pop_late', 'Terlambat', true)}
              {th('mean_deficit', 'Defisit', true)}
              {showMc && <th className="r">P5–P95</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.area_code}>
                <td style={{ maxWidth: 170 }}>
                  <div className="truncate">{r.name}</div>
                  {level === 'kelurahan' && parentNames && <div className="caption muted truncate">{parentNames[r.parent ?? '']}</div>}
                </td>
                <td className="num nowrap">
                  {r.pop_total > 0 ? pct(r.ik) : '—'}
                  {r.pop_total > 0 && (
                    <div style={{ width: 52, marginTop: 4 }}>
                      <IkMeter value={r.ik} p5={showMc ? r.ik_p5 : null} p95={showMc ? r.ik_p95 : null} />
                    </div>
                  )}
                </td>
                <td className="r">{int(r.pop_total)}</td>
                <td className="r">{int(r.pop_late)}</td>
                <td className="r">{r.pop_late > 0 ? minutes(r.mean_deficit) : '—'}</td>
                {showMc && (
                  <td className="r nowrap">
                    {r.ik_p5 != null ? `${pct(r.ik_p5)}–${pct(r.ik_p95)}` : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total kota</td>
              <td className="num">{pct(kota?.ik)}</td>
              <td className="r">{int(kota?.pop_total)}</td>
              <td className="r">{int(kota?.pop_late)}</td>
              <td className="r">{kota && kota.pop_late > 0 ? minutes(kota.mean_deficit) : '—'}</td>
              {showMc && <td className="r nowrap">{kota?.ik_p5 != null ? `${pct(kota.ik_p5)}–${pct(kota.ik_p95)}` : '—'}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="caption muted">
        Baris tampil memuat {int(totalShown)} dari {int(totalAll)} jiwa terdampak. Total penduduk seluruh kota menurut data: {int(kota?.population_all)} jiwa; IK dihitung atas penduduk di zona genangan.
        Defisit = rerata menit kekurangan pada penduduk Terlambat.
      </p>
    </div>
  )
}

export function ShelterTable({ rows }: { rows: ShelterRow[] }) {
  const over = rows.filter((r) => r.load != null && r.load > 1).length
  const unknown = rows.filter((r) => r.load == null).length
  return (
    <div className="stack stack-8">
      <p className="muted">
        Beban B = penduduk yang ditugaskan ke TES terdekat ÷ kapasitas. {int(over)} TES kelebihan beban, {int(unknown)} belum diketahui kapasitasnya. Penugasan tidak mempertimbangkan kapasitas.
      </p>
      <div className="table-wrap">
        <table className="dt compact">
          <thead>
            <tr>
              <th>TES</th>
              <th className="r">Ditugaskan</th>
              <th className="r">Kapasitas</th>
              <th className="r">Beban B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shelter_id}>
                <td style={{ maxWidth: 190 }}>
                  <div className="truncate" title={r.name}>
                    {r.name}
                  </div>
                  <div className="caption muted">
                    {TYPE_LABEL[r.type] ?? r.type}
                    {r.hypothetical && ' · hipotetis'}
                    {r.flag === 'peringatan' && ' · bertanda'}
                  </div>
                </td>
                <td className="r">{int(r.assigned_pop)}</td>
                <td className="r">{r.capacity != null ? int(r.capacity) : '—'}</td>
                <td className="r">
                  {r.load == null ? (
                    <span className="tag tag-outline">kapasitas belum diketahui</span>
                  ) : r.load > 1 ? (
                    <span className="tag tag-red">
                      <Icon name="warning" size={12} />
                      {dec2(r.load)}
                    </span>
                  ) : (
                    <span className="num">{dec2(r.load)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PriorityList({ rows }: { rows: PriorityRow[] }) {
  if (rows.length === 0) return <p className="muted">Tidak ada kelurahan dengan penduduk Terlambat pada skenario ini.</p>
  return (
    <div className="stack stack-8">
      <p className="muted">Kelurahan diurutkan menurut jumlah penduduk Terlambat, lalu rerata defisit. Setiap butir menerima satu kategori utama dan nol sampai tiga penanda.</p>
      <ol className="list-plain list-rows">
        {rows.map((p) => (
          <li key={p.area_code} className="stack stack-8">
            <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="heading-sm">
                  <span className="num muted" style={{ marginRight: 8 }}>
                    {p.rank}.
                  </span>
                  {p.name}
                </div>
                <div className="caption muted">{p.kecamatan}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="num">{int(p.pop_late)} jiwa</div>
                <div className="caption muted">defisit {minutes(p.mean_deficit)}</div>
              </div>
            </div>
            <div className="row">
              <span className={`tag ${p.category === 'tambah_tes' ? 'tag-purple' : 'tag-blue'}`} title={CATEGORY_DESC[p.category]}>
                {CATEGORY_LABEL[p.category]}
              </span>
              {p.flags.map((f) => (
                <span key={f} className="tag tag-outline">
                  {FLAG_LABEL[f] ?? f}
                </span>
              ))}
            </div>
            <details>
              <summary className="row-btn caption">Syarat yang terpenuhi dan angka pendukung</summary>
              <ul className="caption" style={{ paddingLeft: 18, margin: '8px 0 0' }}>
                {p.rationale.map((r) => (
                  <li key={r.rule}>
                    <b>Aturan {r.rule}.</b> {r.text} <span className="num">({r.value})</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function CellCard({ cell, onClose, isPublic }: { cell: CellDetail; onClose: () => void; isPublic?: boolean }) {
  const p = cell.params
  return (
    <section className="tile stack stack-8" aria-labelledby="cell-title" aria-live="polite" style={{ borderColor: 'var(--ink)' }}>
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="cell-title" className="heading-sm truncate">
            Sel #{cell.cell_id} · {cell.kelurahan}
          </h2>
          <span className="caption muted">{cell.kecamatan}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Tutup rincian sel">
          <Icon name="close" />
        </button>
      </div>
      <div className="row between">
        <ClsLabel cls={cell.cls} />
        <span className="caption muted">{CLS_DESC[cell.cls]}</span>
      </div>
      {cell.cls !== 'terputus' ? (
        <>
          <p className="equation" aria-label="Rincian rumus sisa waktu">
            m = {dec1(p.arrival_min)} − ({dec1(p.delay_min)} + {dec1(cell.time_min)}) = <b>{dec1(cell.margin_min)} mnt</b>
          </p>
          <div className="kv">
            <div>TES tujuan</div>
            <div>
              {cell.shelter?.name}
              {cell.shelter?.hypothetical && ' (hipotetis)'}
            </div>
            <div>Jarak jaringan d</div>
            <div>{int(cell.dist_m)} m</div>
            <div>Jarak garis lurus</div>
            <div>
              {int(cell.euclid_m)} m (rasio {cell.euclid_m ? dec2((cell.dist_m ?? 0) / cell.euclid_m) : '—'})
            </div>
            <div>Waktu tempuh t</div>
            <div>{minutes(cell.time_min)}</div>
            <div>Kecepatan efektif</div>
            <div>
              {dec2(p.velocity_ms)} m/detik · {MODE_LABEL[p.mode]}
            </div>
            {!isPublic && (
              <>
                <div>Penduduk sel</div>
                <div>{dec1(cell.population)} jiwa</div>
              </>
            )}
          </div>
          <p className="caption muted">Rute biru di peta adalah jalur terpendek lewat jaringan jalan ke TES terdekat. Ini bukan arahan evakuasi bagi warga.</p>
        </>
      ) : (
        <p className="muted">Sel ini berjarak lebih dari 200 m dari jalan atau berada pada komponen jalan tanpa TES. Perbaiki data jaringan jalan di sekitarnya.</p>
      )}
    </section>
  )
}
