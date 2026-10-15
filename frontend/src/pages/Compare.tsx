import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import MapView, { MapLegend, type MapViewState } from '../components/MapView'
import { Disclaimer, Empty, ErrorNotice, Loading, Notice, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { CLS_LABEL, CLS_ORDER, KIND_LABEL, dateTime, dec2, int, paramLine, pct, signedInt, signedPct } from '../lib/format'
import type { Cls, Layers, Run } from '../lib/types'

interface CompareData {
  a: Run
  b: Run
  areas: { area_code: string; name: string; level: string; parent: string | null; ik_a: number | null; ik_b: number | null; delta_ik: number | null; late_a: number; late_b: number; pop_total: number }[]
  transitions: Record<Cls, Record<Cls, number>>
  moved_late_to_sempat: number
  moved_sempat_to_late: number
  shelter_loads: { shelter_id: string; name: string; hypothetical: boolean; pop_a: number; pop_b: number; load_a: number | null; load_b: number | null; capacity: number | null }[]
}

function runLabel(r: Run & { scenario_name?: string }) {
  return `${r.scenario_name ?? ''} · ${r.label || KIND_LABEL[r.kind]} · ${dateTime(r.finished_at)}`
}

export default function Compare() {
  useDocumentTitle('Bandingkan')
  const [params, setParams] = useSearchParams()
  const a = params.get('a') ?? ''
  const b = params.get('b') ?? ''
  const runs = useQuery({ queryKey: ['runs-done'], queryFn: () => api.get<{ items: (Run & { scenario_name: string })[] }>('/runs?status=selesai') })
  const q = useQuery({ queryKey: ['compare', a, b], queryFn: () => api.get<CompareData>(`/runs/compare?a=${a}&b=${b}`), enabled: !!a && !!b && a !== b })
  const ds = q.data?.a.dataset_id
  const layers = useQuery({ queryKey: ['layers', ds], queryFn: () => api.get<Layers>(`/datasets/${ds}/layers`), enabled: !!ds, staleTime: Infinity })
  const cellsA = useQuery({ queryKey: ['cells', a], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/runs/${a}/cells`), enabled: !!q.data, staleTime: Infinity })
  const cellsB = useQuery({ queryKey: ['cells', b], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/runs/${b}/cells`), enabled: !!q.data, staleTime: Infinity })
  const [view, setView] = useState<MapViewState | null>(null)
  const [level, setLevel] = useState<'kecamatan' | 'kelurahan'>('kecamatan')

  const choose = (k: 'a' | 'b', v: string) => {
    v ? params.set(k, v) : params.delete(k)
    setParams(params, { replace: true })
  }
  const items = (runs.data?.items ?? []).filter((r) => r.kind !== 'matriks')
  const d = q.data

  return (
    <div>
      <Disclaimer />
      <div className="page" style={{ paddingBottom: 24 }}>
        <div className="page-head">
          <div>
            <h1 className="headline">Bandingkan dua hasil</h1>
            <p className="lead">Pilih dua hasil dari dataset yang sama. Peta digeser dan diperbesar bersamaan; tabel menunjukkan selisih IK dan penduduk yang berpindah kelas.</p>
          </div>
        </div>
        <div className="grid-2">
          {(['a', 'b'] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`run-${k}`}>{k === 'a' ? 'Hasil A (dasar)' : 'Hasil B (pembanding)'}</label>
              <select id={`run-${k}`} className="select" value={k === 'a' ? a : b} onChange={(e) => choose(k, e.target.value)}>
                <option value="">Pilih hasil…</option>
                {items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {runLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {a && b && a === b && <Notice kind="warning" title="Pilih dua hasil yang berbeda." />}
        {runs.data && items.length < 2 && (
          <div style={{ marginTop: 24 }}>
            <Empty title="Belum cukup hasil untuk dibandingkan" action={<Link to="/skenario">Buka skenario</Link>}>
              Jalankan dua skenario, atau uji intervensi di editor skenario untuk membuat hasil dasar dan hasil intervensi sekaligus.
            </Empty>
          </div>
        )}
        {q.error && <ErrorNotice error={q.error} />}
        {q.isLoading && a && b && <Loading />}
      </div>

      {d && (
        <>
          <div className="grid-2" style={{ gap: 1, background: 'var(--hairline)', borderTop: '1px solid var(--hairline)', borderBottom: '1px solid var(--hairline)' }}>
            {([['A', d.a, cellsA.data], ['B', d.b, cellsB.data]] as const).map(([k, r, cells]) => (
              <section key={k} style={{ background: '#fff' }} aria-label={`Peta hasil ${k}`}>
                <div style={{ padding: '12px 16px' }}>
                  <div className="row between">
                    <h2 className="heading-sm">
                      {k}: {r.label || KIND_LABEL[r.kind]}
                    </h2>
                    <span className="num" style={{ fontSize: 20, fontWeight: 300 }}>
                      IK {pct(r.summary?.ik)}
                    </span>
                  </div>
                  <p className="caption muted">
                    {paramLine({ ...r.params, delay_min: r.summary?.effective_delay_min ?? r.params.delay_min })}
                    {r.with_interventions && ` · ${r.interventions.map((i) => i.label).join('; ')}`}
                  </p>
                </div>
                <div style={{ position: 'relative', height: 'min(56vh, 520px)', minHeight: 320 }}>
                  <MapView
                    label={`Peta kelas sisa waktu hasil ${k}`}
                    layers={layers.data}
                    cells={cells}
                    hypothetical={r.shelters_extra.map((h) => ({ lon: h.lon, lat: h.lat, name: h.name }))}
                    view={view}
                    onViewChange={setView}
                  >
                    {k === 'A' && <MapLegend />}
                  </MapView>
                </div>
              </section>
            ))}
          </div>

          <div className="page" style={{ paddingTop: 32 }}>
            <div className="grid-4">
              <div className="stat">
                <div className="k">Selisih IK kota (B − A)</div>
                <div className="v">{signedPct((d.b.summary?.ik ?? 0) - (d.a.summary?.ik ?? 0))}</div>
                <div className="d">
                  {pct(d.a.summary?.ik)} → {pct(d.b.summary?.ik)}
                </div>
              </div>
              <div className="stat">
                <div className="k">Terlambat → Sempat</div>
                <div className="v">{int(d.moved_late_to_sempat)}</div>
                <div className="d">jiwa berpindah ke Cukup atau Rawan</div>
              </div>
              <div className="stat">
                <div className="k">Sempat → Terlambat</div>
                <div className="v">{int(d.moved_sempat_to_late)}</div>
                <div className="d">jiwa memburuk</div>
              </div>
              <div className="stat">
                <div className="k">Penduduk Terlambat</div>
                <div className="v">{signedInt((d.b.summary?.pop_late ?? 0) - (d.a.summary?.pop_late ?? 0))}</div>
                <div className="d">
                  {int(d.a.summary?.pop_late)} → {int(d.b.summary?.pop_late)} jiwa
                </div>
              </div>
            </div>

            <div className="grid-2 section" style={{ gap: 32 }}>
              <section aria-labelledby="delta-title">
                <div className="section-head">
                  <h2 id="delta-title" className="subhead">
                    Selisih IK per wilayah
                  </h2>
                  <label htmlFor="cmp-lvl" className="sr-only">
                    Tingkat wilayah
                  </label>
                  <select id="cmp-lvl" className="select" style={{ width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value as any)}>
                    <option value="kecamatan">Kecamatan</option>
                    <option value="kelurahan">Kelurahan</option>
                  </select>
                </div>
                <div className="table-wrap">
                  <table className="dt compact">
                    <thead>
                      <tr>
                        <th>Wilayah</th>
                        <th className="r">IK A</th>
                        <th className="r">IK B</th>
                        <th className="r">Selisih</th>
                        <th className="r">Terlambat A → B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.areas
                        .filter((x) => x.level === level && x.pop_total > 0)
                        .sort((x, y) => (y.delta_ik ?? 0) - (x.delta_ik ?? 0))
                        .map((x) => (
                          <tr key={x.area_code}>
                            <td>{x.name}</td>
                            <td className="r">{pct(x.ik_a)}</td>
                            <td className="r">{pct(x.ik_b)}</td>
                            <td className="r" style={{ fontWeight: x.delta_ik ? 600 : 400, color: (x.delta_ik ?? 0) < 0 ? 'var(--error)' : undefined }}>
                              {signedPct(x.delta_ik)}
                            </td>
                            <td className="r nowrap">
                              {int(x.late_a)} → {int(x.late_b)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-labelledby="tr-title" className="stack stack-24">
                <div>
                  <h2 id="tr-title" className="subhead" style={{ marginBottom: 16 }}>
                    Perpindahan kelas (jiwa)
                  </h2>
                  <div className="table-wrap">
                    <table className="dt compact">
                      <caption className="sr-only">Baris kelas pada hasil A, kolom kelas pada hasil B</caption>
                      <thead>
                        <tr>
                          <th>A \ B</th>
                          {CLS_ORDER.map((c) => (
                            <th key={c} className="r">
                              {CLS_LABEL[c]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CLS_ORDER.map((f) => (
                          <tr key={f}>
                            <th scope="row" style={{ fontWeight: 600, background: 'transparent' }}>
                              {CLS_LABEL[f]}
                            </th>
                            {CLS_ORDER.map((t) => (
                              <td key={t} className="r" style={{ background: f === t ? 'var(--surface-1)' : undefined }}>
                                {int(d.transitions[f][t])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h2 className="subhead" style={{ marginBottom: 16 }}>
                    Perubahan beban TES
                  </h2>
                  <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                    <table className="dt compact">
                      <thead>
                        <tr>
                          <th>TES</th>
                          <th className="r">Penduduk A → B</th>
                          <th className="r">Beban A → B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.shelter_loads
                          .filter((x) => x.pop_a !== x.pop_b)
                          .map((x) => (
                            <tr key={x.shelter_id}>
                              <td>
                                {x.name}
                                {x.hypothetical && <span className="tag tag-blue" style={{ marginLeft: 6 }}>hipotetis</span>}
                              </td>
                              <td className="r nowrap">
                                {int(x.pop_a)} → {int(x.pop_b)}
                              </td>
                              <td className="r nowrap">
                                {x.load_a != null ? dec2(x.load_a) : '—'} → {x.load_b != null ? dec2(x.load_b) : x.capacity == null ? 'kapasitas ?' : '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
