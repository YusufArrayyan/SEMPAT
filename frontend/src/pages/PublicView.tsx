import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import MapView, { MapLegend } from '../components/MapView'
import { AreaTable, CellCard, PriorityList } from '../components/ResultPanels'
import { Logo } from '../components/Shell'
import { Disclaimer, ErrorNotice, Icon, IkMeter, Loading, Tabs, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { MODE_LABEL, dateTime, dec1, int, pct } from '../lib/format'
import type { AreaRow, CellDetail, Layers, PriorityRow, Run } from '../lib/types'

interface PublicData {
  run: Pick<Run, 'id' | 'kind' | 'params' | 'summary' | 'finished_at' | 'engine_version' | 'seed' | 'with_interventions' | 'input_hash' | 'mc'>
  scenario_name: string
  dataset: { name: string; version: number; source: string; license: string; accessed_at: string; checksum: string }
  areas: AreaRow[]
  priorities: PriorityRow[]
  layers: Layers
}

export default function PublicView() {
  const { token } = useParams()
  const q = useQuery({ queryKey: ['public', token], queryFn: () => api.get<PublicData>(`/public/${token}`) })
  const cells = useQuery({ queryKey: ['public-cells', token], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/public/${token}/cells`), enabled: !!q.data })
  const [cellId, setCellId] = useState<number | null>(null)
  const cell = useQuery({ queryKey: ['public-cell', token, cellId], queryFn: () => api.get<CellDetail>(`/public/${token}/cells/${cellId}`), enabled: cellId != null })
  const [tab, setTab] = useState<'wilayah' | 'prioritas'>('wilayah')
  useDocumentTitle(q.data ? `Hasil publik: ${q.data.scenario_name}` : 'Hasil publik')

  const header = (
    <header className="shell-header">
      <span className="brand">
        <Logo />
        <b>Sempat</b>
        <span>Tampilan publik baca-saja</span>
      </span>
    </header>
  )
  if (q.isLoading)
    return (
      <>
        {header}
        <div className="page">
          <Loading />
        </div>
      </>
    )
  if (q.error || !q.data)
    return (
      <>
        {header}
        <div className="page">
          <ErrorNotice error={q.error} />
        </div>
      </>
    )
  const d = q.data
  const s = d.run.summary!
  return (
    <>
      {header}
      <main className="workspace" id="main">
        <div className="workspace-map">
          <MapView label="Peta kelas sisa waktu (tampilan publik). Sel berpenduduk kurang dari 10 jiwa disembunyikan." layers={d.layers} cells={cells.data} route={cell.data?.route} selectedCell={cellId} onCellClick={setCellId}>
            <div className="map-overlay map-params">
              <span>
                τ <b>{dec1(s.effective_delay_min)}</b> mnt
              </span>
              <span>
                Tₐ <b>{dec1(d.run.params.arrival_min)}</b> mnt
              </span>
              <span>
                <b>{MODE_LABEL[d.run.params.mode]}</b>
              </span>
            </div>
            <MapLegend />
          </MapView>
        </div>
        <aside className="workspace-panel" aria-label="Ringkasan hasil">
          <Disclaimer />
          <div className="panel-head">
            <p className="caption muted">Kota Bengkulu · {dateTime(d.run.finished_at)}</p>
            <h1 className="title">{d.scenario_name}</h1>
          </div>
          <div className="panel-body stack stack-24">
            {cellId != null && cell.data && <CellCard cell={cell.data} onClose={() => setCellId(null)} isPublic />}
            <section className="stack stack-8" aria-label="Ringkasan">
              <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
                <span className="display num">{pct(s.ik)}</span>
                <span className="muted">indeks kecukupan kota</span>
              </div>
              <IkMeter value={s.ik} p5={s.mc?.ik_p5} p95={s.mc?.ik_p95} />
              <p className="muted">
                Dari {int(s.pop_total)} penduduk di zona genangan, {int(s.pop_late)} jiwa diperkirakan tidak sempat mencapai tempat evakuasi pada skenario ini (jeda {dec1(s.effective_delay_min)} menit,
                gelombang tiba {dec1(d.run.params.arrival_min)} menit, {MODE_LABEL[d.run.params.mode].toLowerCase()}).
              </p>
              {d.run.with_interventions && <p className="caption">Hasil ini memuat intervensi uji (misalnya TES hipotetis) yang belum tentu ada di lapangan.</p>}
              <a className="btn btn-tertiary btn-md" href={`/api/public/${token}/report.pdf`} style={{ alignSelf: 'flex-start' }}>
                Unduh PDF ringkasan <Icon name="download" />
              </a>
            </section>
            <div>
              <Tabs
                label="Bagian hasil"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'wilayah', label: 'Indeks kecamatan' },
                  { id: 'prioritas', label: 'Prioritas' },
                ]}
              />
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ paddingTop: 16 }}>
                {tab === 'wilayah' ? <AreaTable rows={d.areas} level="kecamatan" showMc={d.run.kind === 'monte_carlo'} /> : <PriorityList rows={d.priorities} />}
              </div>
            </div>
            <section className="caption muted stack stack-8" aria-label="Sumber dan penafian">
              <p>
                <b>Penafian.</b> Hasil adalah uji kecukupan tempat evakuasi pada skenario terpilih, bukan prediksi tsunami dan bukan arahan evakuasi. Ikuti arahan resmi BPBD saat keadaan darurat.
              </p>
              <p>
                Data: {d.dataset.name} v{d.dataset.version} · {d.dataset.license} · diakses {d.dataset.accessed_at}. Sumber: {d.dataset.source}
              </p>
              <p className="mono">
                hash masukan {d.run.input_hash.slice(0, 16)} · mesin {d.run.engine_version}
              </p>
            </section>
          </div>
        </aside>
      </main>
    </>
  )
}
