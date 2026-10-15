import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import MapView, { MapLegend } from '../components/MapView'
import { AreaTable, CellCard, PriorityList, ShelterTable } from '../components/ResultPanels'
import { RunProgress, RunStatusTag, useRun } from '../components/RunBits'
import { CopyButton, Disclaimer, ErrorNotice, Icon, IkMeter, Loading, Notice, Tabs, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { CLS_ORDER, KIND_LABEL, MODE_LABEL, dateTime, dec1, dec2, int, pct } from '../lib/format'
import type { AreaRow, CellDetail, Layers, PriorityRow, Run, ShelterRow } from '../lib/types'

type Tab = 'wilayah' | 'tes' | 'prioritas' | 'matriks' | 'laporan'

interface MatrixData {
  variants: { key: string; delay: number; arrival: number; mode: 'jalan_kaki' | 'kendaraan' }[]
  rows: { area_code: string; name: string; level: string; values: Record<string, { ik: number | null; pop_late: number }> }[]
}

function MatrixTable({ runId }: { runId: string }) {
  const q = useQuery({ queryKey: ['matrix', runId], queryFn: () => api.get<MatrixData>(`/runs/${runId}/matrix`) })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorNotice error={q.error} />
  const { variants, rows } = q.data!
  return (
    <div className="stack stack-8">
      <p className="muted">IK per kecamatan untuk 12 kombinasi jeda × waktu tiba × moda. Jarak jaringan dihitung sekali lalu dipakai ulang.</p>
      <div className="table-wrap">
        <table className="dt compact">
          <thead>
            <tr>
              <th rowSpan={2}>Kecamatan</th>
              {[0, 5, 10].map((t) => (
                <th key={t} colSpan={4} style={{ textAlign: 'center', borderLeft: '1px solid var(--hairline-strong)' }}>
                  τ = {t} mnt
                </th>
              ))}
            </tr>
            <tr>
              {variants.map((v, i) => (
                <th key={v.key} className="r" style={{ top: 36, borderLeft: i % 4 === 0 ? '1px solid var(--hairline-strong)' : undefined, fontWeight: 400 }} title={`τ ${v.delay}, Tₐ ${v.arrival}, ${MODE_LABEL[v.mode]}`}>
                  {v.arrival}′ {v.mode === 'jalan_kaki' ? 'JK' : 'KD'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => Object.values(r.values).some((x) => x.ik != null))
              .map((r) => (
                <tr key={r.area_code} style={r.level === 'kota' ? { fontWeight: 600, background: 'var(--surface-1)' } : undefined}>
                  <td className="nowrap">{r.name}</td>
                  {variants.map((v, i) => {
                    const val = r.values[v.key]?.ik
                    return (
                      <td key={v.key} className="r" style={{ borderLeft: i % 4 === 0 ? '1px solid var(--hairline-strong)' : undefined, background: val != null ? `rgba(0,158,115,${(val * 0.35).toFixed(2)})` : undefined }}>
                        {val != null ? Math.round(val * 100) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="caption muted">Angka dalam persen. Kolom: waktu tiba (menit) dan moda — JK jalan kaki, KD kendaraan. Warna latar hanya penguat; angka adalah nilainya.</p>
    </div>
  )
}

function ReportPanel({ run }: { run: Run }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [made, setMade] = useState<Record<string, string>>({})
  const make = useMutation({
    mutationFn: (format: string) => api.post<{ id: string; url: string; format: string }>(`/runs/${run.id}/reports`, { format }),
    onSuccess: (r) => {
      setMade((m) => ({ ...m, [r.format]: r.url }))
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      window.location.assign(r.url)
    },
  })
  const share = useMutation({ mutationFn: () => api.post<{ token: string }>(`/runs/${run.id}/share`), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }) })
  const unshare = useMutation({ mutationFn: () => api.del(`/runs/${run.id}/share`), onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }) })
  const formats = [
    { k: 'pdf', label: 'Laporan PDF', desc: '2–4 halaman: parameter, versi data, peta, indeks, prioritas, beban TES, batasan.' },
    { k: 'csv_wilayah', label: 'CSV indeks wilayah', desc: 'IK per kecamatan dan kelurahan, termasuk varian matriks dan persentil Monte Carlo.' },
    { k: 'csv_sel', label: 'CSV hasil sel', desc: 'Kelas, jarak, waktu tempuh, dan sisa waktu per sel 100 m.' },
    { k: 'geojson', label: 'GeoJSON sel', desc: 'Poligon sel dengan kelas untuk dibuka di QGIS atau aplikasi SIG lain.' },
  ]
  const publicUrl = run.share_token ? `${window.location.origin}/publik/${run.share_token}` : null
  return (
    <div className="stack stack-24">
      <div className="stack stack-8">
        <h3 className="heading-sm">Ekspor</h3>
        {make.error && <ErrorNotice error={make.error} />}
        <ul className="list-plain list-rows">
          {formats.map((f) => (
            <li key={f.k} className="row between" style={{ flexWrap: 'nowrap' }}>
              <div style={{ minWidth: 0 }}>
                <div>{f.label}</div>
                <div className="caption muted">{f.desc}</div>
              </div>
              <button className="btn btn-tertiary btn-md" onClick={() => make.mutate(f.k)} disabled={!can('peneliti') || make.isPending} aria-label={`Unduh ${f.label}`}>
                {make.isPending && make.variables === f.k ? 'Menyiapkan…' : made[f.k] ? 'Unduh lagi' : 'Unduh'} <Icon name="download" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="stack stack-8">
        <h3 className="heading-sm">Tautan publik baca-saja</h3>
        <p className="caption muted">Menampilkan peta dan IK tanpa data akun. Sel berpenduduk kurang dari 10 jiwa disembunyikan. Hanya untuk dataset berlisensi terbuka.</p>
        {(share.error || unshare.error) && <ErrorNotice error={share.error || unshare.error} />}
        {publicUrl ? (
          <>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input mono" readOnly value={publicUrl} aria-label="Alamat tautan publik" onFocus={(e) => e.target.select()} />
              <CopyButton text={publicUrl} />
            </div>
            <div className="btn-row gap">
              <a className="btn btn-ghost btn-md" href={publicUrl} target="_blank" rel="noreferrer">
                Buka tampilan publik <Icon name="link" />
              </a>
              {can('analis') && (
                <button className="btn btn-ghost btn-md" style={{ color: 'var(--error)' }} onClick={() => window.confirm('Cabut tautan publik? Siapa pun yang memegang tautan ini tidak dapat membukanya lagi.') && unshare.mutate()} disabled={unshare.isPending}>
                  Cabut tautan
                </button>
              )}
            </div>
          </>
        ) : can('analis') ? (
          <div>
            <button className="btn btn-secondary btn-md" onClick={() => share.mutate()} disabled={share.isPending}>
              Buat tautan publik <Icon name="link" />
            </button>
          </div>
        ) : (
          <p className="caption">Peran Analis diperlukan untuk membuat tautan publik.</p>
        )}
      </div>
    </div>
  )
}

export default function Results() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const run = useRun(id)
  const r = run.data
  const done = r?.status === 'selesai'
  useDocumentTitle(r ? `Hasil ${r.scenario_name}` : 'Hasil')
  const layers = useQuery({ queryKey: ['layers', r?.dataset_id], queryFn: () => api.get<Layers>(`/datasets/${r!.dataset_id}/layers`), enabled: !!r, staleTime: Infinity })
  const cells = useQuery({ queryKey: ['cells', id], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/runs/${id}/cells`), enabled: done, staleTime: Infinity })
  const areas = useQuery({ queryKey: ['areas', id], queryFn: () => api.get<{ items: AreaRow[] }>(`/runs/${id}/areas`), enabled: done, staleTime: Infinity })
  const shelters = useQuery({ queryKey: ['shelters', id], queryFn: () => api.get<{ items: ShelterRow[] }>(`/runs/${id}/shelters`), enabled: done, staleTime: Infinity })
  const prio = useQuery({ queryKey: ['prio', id], queryFn: () => api.get<{ items: PriorityRow[] }>(`/runs/${id}/priorities`), enabled: done, staleTime: Infinity })
  const [cellId, setCellId] = useState<number | null>(params.get('sel') ? Number(params.get('sel')) : null)
  const cell = useQuery({ queryKey: ['cell', id, cellId], queryFn: () => api.get<CellDetail>(`/runs/${id}/cells/${cellId}`), enabled: done && cellId != null, staleTime: Infinity })
  const [level, setLevel] = useState<'kecamatan' | 'kelurahan'>('kecamatan')
  const tab = (params.get('tab') as Tab) || (r?.kind === 'matriks' ? 'matriks' : 'wilayah')
  const setTab = (t: Tab) => {
    params.set('tab', t)
    setParams(params, { replace: true })
  }
  const [vis, setVis] = useState({ roads: true, kelurahan: true, zones: true, sirens: true, shelters: true, cells: true })
  const parentNames = useMemo(() => Object.fromEntries((areas.data?.items ?? []).filter((a) => a.level === 'kecamatan').map((a) => [a.area_code, a.name])), [areas.data])
  const roads = useQuery({ queryKey: ['roads', r?.dataset_id], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/datasets/${r!.dataset_id}/roads`), enabled: !!r && vis.roads, staleTime: Infinity })

  if (run.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    )
  if (run.error || !r)
    return (
      <div className="page">
        <ErrorNotice error={run.error} />
      </div>
    )

  const s = r.summary
  const hypo = r.shelters_extra.map((h) => ({ lon: h.lon, lat: h.lat, name: h.name }))
  const selectCell = (cid: number | null) => {
    setCellId(cid)
    cid == null ? params.delete('sel') : params.set('sel', String(cid))
    setParams(params, { replace: true })
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'wilayah', label: 'Indeks wilayah' },
    { id: 'tes', label: 'Beban TES' },
    { id: 'prioritas', label: `Prioritas${prio.data ? ` (${prio.data.items.length})` : ''}` },
    ...(r.kind === 'matriks' ? [{ id: 'matriks' as Tab, label: 'Matriks 12' }] : []),
    { id: 'laporan', label: 'Laporan' },
  ]
  const toggle = (k: keyof typeof vis, label: string) => (
    <label className="checkbox" style={{ minHeight: 24 }}>
      <input type="checkbox" checked={vis[k]} onChange={(e) => setVis((v) => ({ ...v, [k]: e.target.checked }))} />
      {label}
    </label>
  )

  return (
    <div className="workspace">
      <div className="workspace-map">
        <MapView
          label="Peta kelas sisa waktu per sel 100 meter. Klik sel untuk melihat rute ke TES terdekat dan rincian waktu. Padanan tabel ada di panel kanan."
          layers={layers.data}
          roads={vis.roads ? roads.data : null}
          cells={cells.data}
          route={cell.data?.route ?? null}
          selectedCell={cellId}
          hypothetical={hypo}
          blocked={s?.blocked_segments ?? []}
          onCellClick={selectCell}
          visible={vis}
        >
          {done && (
            <div className="map-overlay map-params" aria-label="Parameter yang membentuk peta">
              <span>
                τ <b>{dec1(s?.effective_delay_min)}</b> mnt
              </span>
              <span>
                Tₐ <b>{dec1(r.params.arrival_min)}</b> mnt
              </span>
              <span>
                <b>{MODE_LABEL[r.params.mode]}</b> {dec2(s?.velocity_ms)} m/dtk
              </span>
              {r.params.night && <span>Malam</span>}
              {r.with_interventions && <span className="tag tag-blue">+ intervensi</span>}
            </div>
          )}
          <MapLegend
            toggles={
              <>
                {toggle('cells', 'Sel hasil')}
                {toggle('roads', 'Jalan')}
                {toggle('zones', 'Zona genangan')}
                {toggle('shelters', 'TES')}
                {toggle('sirens', 'Sirene')}
                {toggle('kelurahan', 'Batas kelurahan')}
              </>
            }
          />
        </MapView>
      </div>
      <aside className="workspace-panel" aria-label="Panel hasil">
        <Disclaimer />
        <div className="panel-head">
          <nav className="breadcrumb" aria-label="Remah roti">
            <Link to="/skenario">Skenario</Link> <span aria-hidden="true">/</span>
            <Link to={`/skenario/${r.scenario_id}`}>{r.scenario_name}</Link> <span aria-hidden="true">/</span>
            <span>Hasil</span>
          </nav>
          <div className="row between">
            <h1 className="title">{r.label || KIND_LABEL[r.kind]}</h1>
            <RunStatusTag status={r.status} />
          </div>
          <p className="caption muted" style={{ marginTop: 4 }}>
            {dateTime(r.finished_at ?? r.created_at)}
            {r.duration_s != null && ` · ${dec2(r.duration_s)} dtk`} · mesin {r.engine_version}
            {r.seed != null && ` · benih ${r.seed}`}
          </p>
        </div>
        <div className="panel-body stack stack-24">
          {!done && <RunProgress run={r} />}
          {done && s && (
            <>
              {cellId != null && (cell.data ? <CellCard cell={cell.data} onClose={() => selectCell(null)} /> : cell.error ? <ErrorNotice error={cell.error} /> : <Loading rows={3} />)}
              <section aria-labelledby="sum-title" className="stack stack-8">
                <h2 id="sum-title" className="sr-only">
                  Ringkasan
                </h2>
                <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
                  <span className="display num">{pct(s.ik)}</span>
                  <span className="muted">indeks kecukupan kota</span>
                </div>
                <IkMeter value={s.ik} p5={s.mc?.ik_p5} p95={s.mc?.ik_p95} />
                {s.mc && (
                  <p className="caption">
                    Monte Carlo ({r.mc?.n} undian): median {pct(s.mc.ik_p50)}, rentang P5–P95 {pct(s.mc.ik_p5)}–{pct(s.mc.ik_p95)}.
                  </p>
                )}
                <p className="muted">
                  Dari {int(s.pop_total)} penduduk di zona genangan, <b>{int(s.pop_late)}</b> jiwa tidak sempat mencapai TES pada τ {dec1(s.effective_delay_min)} menit, Tₐ {dec1(r.params.arrival_min)} menit, {MODE_LABEL[r.params.mode].toLowerCase()}.
                </p>
                <div className="bar" role="img" aria-label={CLS_ORDER.map((c) => `${c} ${int((s as any)[c === 'terlambat' ? 'pop_late' : `pop_${c}`])} jiwa`).join(', ')}>
                  {CLS_ORDER.map((c) => {
                    const v = c === 'terlambat' ? s.pop_late : (s as any)[`pop_${c}`]
                    return <span key={c} className={`swatch-${c}`} style={{ width: `${(v / Math.max(1, s.pop_total)) * 100}%`, border: 0 }} />
                  })}
                </div>
                <div className="grid-2" style={{ gap: 4 }}>
                  {CLS_ORDER.map((c) => {
                    const v = c === 'terlambat' ? s.pop_late : (s as any)[`pop_${c}`]
                    return (
                      <div key={c} className="row between caption" style={{ flexWrap: 'nowrap' }}>
                        <span className="cls-label">
                          <span className={`swatch swatch-${c}`} aria-hidden="true" />
                          {c[0].toUpperCase() + c.slice(1)}
                        </span>
                        <span className="num">{int(v)} jiwa</span>
                      </div>
                    )
                  })}
                </div>
                {r.with_interventions && r.base_run_id && (
                  <Notice kind="info" title={`Hasil ini memuat ${r.interventions.length} intervensi.`} action={<Link to={`/bandingkan?a=${r.base_run_id}&b=${r.id}`} className="btn btn-ghost btn-sm">Bandingkan dengan dasar</Link>}>
                    {r.interventions.map((i) => i.label).join('; ')}
                  </Notice>
                )}
                {cellId == null && <p className="caption muted">Klik sel di peta untuk melihat rute ke TES terdekat dan rincian waktu.</p>}
              </section>

              <div>
                <Tabs label="Bagian hasil" tabs={tabs} value={tab} onChange={setTab} />
                <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ paddingTop: 16 }}>
                  {tab === 'wilayah' && (areas.data ? <AreaTable rows={areas.data.items} level={level} onLevel={setLevel} showMc={r.kind === 'monte_carlo'} parentNames={parentNames} /> : <Loading />)}
                  {tab === 'tes' && (shelters.data ? <ShelterTable rows={shelters.data.items} /> : <Loading />)}
                  {tab === 'prioritas' && (prio.data ? <PriorityList rows={prio.data.items} /> : <Loading />)}
                  {tab === 'matriks' && <MatrixTable runId={r.id} />}
                  {tab === 'laporan' && <ReportPanel run={r} />}
                </div>
              </div>

              <details>
                <summary className="row-btn caption">Ketertelusuran hasil</summary>
                <div className="kv caption" style={{ marginTop: 8 }}>
                  <div>Dataset</div>
                  <div>
                    {r.dataset?.name} v{r.dataset?.version}
                  </div>
                  <div>Hash dataset</div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>
                    {r.dataset?.checksum}
                  </div>
                  <div>Hash masukan</div>
                  <div className="mono" style={{ wordBreak: 'break-all' }}>
                    {r.input_hash}
                  </div>
                  <div>Versi mesin</div>
                  <div>{r.engine_version}</div>
                  <div>ID run</div>
                  <div className="mono">{r.id}</div>
                </div>
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
