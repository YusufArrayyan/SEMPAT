import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MapView, { MapLegend } from '../components/MapView'
import { ErrorNotice, Icon, Loading, Notice, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { DS_STATUS, TYPE_LABEL, bytes, dateTime, int, pct } from '../lib/format'
import type { Dataset, Layers, Meta } from '../lib/types'
import { DatasetMetaFields } from './DataPage'

const ORDER = ['wilayah', 'penduduk', 'jalan', 'genangan', 'tes', 'sirene']
const REQUIRED = new Set(['tes', 'jalan', 'wilayah', 'penduduk', 'genangan'])

function UploadCard({ ds, kind, label, exts, disabled }: { ds: Dataset; kind: string; label: string; exts: string[]; disabled: boolean }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const info = ds.files?.[kind]
  const [showRejects, setShowRejects] = useState(false)
  const up = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload(`/datasets/${ds.id}/files?kind=${kind}`, fd)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dataset', ds.id] }),
  })
  return (
    <div className="tile stack stack-8">
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <h3 className="heading-sm">{label}</h3>
        {REQUIRED.has(kind) ? <span className="tag tag-outline">Wajib</span> : <span className="tag">Opsional</span>}
      </div>
      {info ? (
        <>
          <p className="truncate mono" title={info.name}>
            {info.name} · {bytes(info.size)}
          </p>
          <p className="caption">
            <span className="num">{int(info.rows_ok)}</span> baris diterima
            {info.rows_rejected > 0 && (
              <>
                {' · '}
                <button className="row-btn" onClick={() => setShowRejects((s) => !s)} aria-expanded={showRejects}>
                  {int(info.rows_rejected)} ditolak
                </button>
              </>
            )}
            {' · '}CRS {info.crs}
          </p>
          {showRejects && (
            <ul className="caption" style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflow: 'auto' }}>
              {info.rejected.map((r, i) => (
                <li key={i}>
                  Baris {r.row}: {r.reason}
                </li>
              ))}
            </ul>
          )}
          {info.warnings.length > 0 && <p className="caption" style={{ color: '#8e6a00' }}>{info.warnings[0]}</p>}
        </>
      ) : (
        <p className="caption muted">Belum diunggah. Format: {exts.join(', ')}</p>
      )}
      {up.error && <ErrorNotice error={up.error} />}
      {!disabled && (
        <>
          <input
            ref={input}
            type="file"
            accept={exts.join(',')}
            className="sr-only"
            id={`f-${kind}`}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) up.mutate(f)
              e.target.value = ''
            }}
          />
          <button className="btn btn-tertiary btn-md" onClick={() => input.current?.click()} disabled={up.isPending} aria-describedby={`f-${kind}`}>
            {up.isPending ? 'Mengunggah…' : info ? 'Ganti berkas' : 'Unggah berkas'} <Icon name="upload" />
          </button>
        </>
      )}
    </div>
  )
}

export default function DatasetDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['dataset', id], queryFn: () => api.get<Dataset>(`/datasets/${id}`) })
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: Infinity })
  const layers = useQuery({ queryKey: ['layers', id, q.data?.validation?.generated_at], queryFn: () => api.get<Layers>(`/datasets/${id}/layers`), enabled: !!q.data })
  const roads = useQuery({ queryKey: ['roads', id, q.data?.files?.jalan?.uploaded_at], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/datasets/${id}/roads`), enabled: !!q.data?.files?.jalan })
  const [form, setForm] = useState<Partial<Dataset>>({})
  useDocumentTitle(q.data ? `${q.data.name} v${q.data.version}` : 'Dataset')
  useEffect(() => {
    if (q.data) setForm(q.data)
  }, [q.data?.id, q.data?.status])

  const inv = (d: Dataset) => {
    qc.setQueryData(['dataset', id], d)
    qc.invalidateQueries({ queryKey: ['datasets'] })
  }
  const save = useMutation({ mutationFn: () => api.patch<Dataset>(`/datasets/${id}`, { name: form.name, source: form.source, license: form.license, license_open: form.license_open, accessed_at: form.accessed_at, notes: form.notes ?? '' }), onSuccess: inv })
  const validate = useMutation({ mutationFn: () => api.post<Dataset>(`/datasets/${id}/validate`), onSuccess: inv })
  const publish = useMutation({ mutationFn: () => api.post<Dataset>(`/datasets/${id}/publish`), onSuccess: inv })
  const newVersion = useMutation({ mutationFn: () => api.post<Dataset>(`/datasets/${id}/new-version`), onSuccess: (d) => nav(`/data/${d.id}`) })

  if (q.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    )
  if (q.error || !q.data)
    return (
      <div className="page">
        <ErrorNotice error={q.error} />
      </div>
    )
  const ds = q.data
  const frozen = ds.status === 'terbit'
  const v = ds.validation
  const dirty = ['name', 'source', 'license', 'license_open', 'accessed_at'].some((k) => (form as any)[k] !== (ds as any)[k])

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Remah roti">
        <Link to="/data">Data</Link> <span aria-hidden="true">/</span> <span>{ds.name}</span>
      </nav>
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`tag ${DS_STATUS[ds.status][1]}`}>{DS_STATUS[ds.status][0]}</span>
            <span className="caption muted">Versi {ds.version}</span>
            {ds.checksum && <span className="mono muted">hash {ds.checksum.slice(0, 16)}</span>}
          </div>
          <h1 className="headline">{ds.name}</h1>
        </div>
        <div className="btn-row">
          {frozen && can('peneliti') && (
            <button className="btn btn-tertiary" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>
              Buat versi baru untuk koreksi <Icon name="copy" />
            </button>
          )}
          {!frozen && can('peneliti') && (
            <button className="btn btn-secondary" onClick={() => validate.mutate()} disabled={validate.isPending}>
              {validate.isPending ? 'Memvalidasi dan membentuk kisi…' : 'Jalankan validasi'}
            </button>
          )}
          {!frozen && can('analis') && (
            <button className="btn btn-primary" onClick={() => publish.mutate()} disabled={publish.isPending || ds.status !== 'tervalidasi'} title={ds.status !== 'tervalidasi' ? 'Lulus validasi terlebih dahulu' : undefined}>
              Terbitkan <Icon name="check" />
            </button>
          )}
        </div>
      </div>
      {[validate.error, publish.error, newVersion.error, save.error].map((e, i) => e && <ErrorNotice key={i} error={e} />)}
      {frozen && (
        <Notice kind="info" title="Dataset terbit dibekukan.">
          Isi tidak dapat diubah. Setiap hasil perhitungan menyimpan ID versi ini. Untuk koreksi, buat versi baru.
        </Notice>
      )}

      <div className="grid-2 section" style={{ gap: 32, marginTop: 24 }}>
        <section aria-labelledby="meta-title" className="stack stack-16">
          <h2 id="meta-title" className="subhead">
            Tata kelola data
          </h2>
          <DatasetMetaFields v={form} set={(k, val) => setForm((f) => ({ ...f, [k]: val }))} disabled={frozen || !can('peneliti')} />
          {!frozen && can('peneliti') && (
            <div>
              <button className="btn btn-tertiary btn-md" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? 'Menyimpan…' : 'Simpan metadata'}
              </button>
            </div>
          )}
        </section>
        <section aria-labelledby="prev-title">
          <h2 id="prev-title" className="subhead" style={{ marginBottom: 16 }}>
            Pratinjau peta
          </h2>
          <div style={{ position: 'relative', height: 420, border: '1px solid var(--hairline)' }}>
            <MapView label="Pratinjau data: batas wilayah, zona genangan, jalan, TES, dan sirene" layers={layers.data} roads={roads.data}>
              <MapLegend showClasses={false} />
            </MapView>
          </div>
        </section>
      </div>

      <section className="section" aria-labelledby="imp-title">
        <div className="section-head">
          <h2 id="imp-title" className="subhead">
            Impor berkas
          </h2>
          <span className="caption muted">Baris tak valid ditolak dengan alasan per baris; baris valid tersimpan.</span>
        </div>
        <div className="grid-3">
          {ORDER.map((k) => (
            <UploadCard key={k} ds={ds} kind={k} label={meta.data?.file_kinds[k] ?? k} exts={meta.data?.allowed_ext[k] ?? []} disabled={frozen || !can('peneliti')} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="val-title">
        <div className="section-head">
          <h2 id="val-title" className="subhead">
            Laporan validasi
          </h2>
          {v && <span className="caption muted">Dibuat {dateTime(v.generated_at)}</span>}
        </div>
        {!v ? (
          <Notice kind="info" title="Validasi belum dijalankan.">
            Validasi memeriksa CRS, geometri, penduduk, komponen jalan, dan posisi TES terhadap zona genangan, lalu membentuk kisi 100 m.
          </Notice>
        ) : (
          <div className="stack stack-16">
            {v.errors.length > 0 ? (
              <Notice kind="error" title={`${v.errors.length} galat kritis — dataset belum dapat diterbitkan`}>
                <ul>
                  {v.errors.map((e, i) => (
                    <li key={i}>
                      {e.message} <span className="muted">{e.hint}</span>
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : (
              <Notice kind="success" title="Tidak ada galat kritis." />
            )}
            {v.warnings.length > 0 && (
              <Notice kind="warning" title={`${v.warnings.length} peringatan`}>
                <ul>
                  {v.warnings.map((e, i) => (
                    <li key={i}>
                      {e.message} <span className="muted">{e.hint}</span>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <div className="grid-4">
              <div className="stat">
                <div className="k">Simpul / ruas jalan</div>
                <div className="v">
                  {int(v.road.nodes)} / {int(v.road.edges)}
                </div>
                <div className="d">
                  {int(v.road.components)} komponen; terbesar {pct(v.road.largest_component_share)}
                </div>
              </div>
              <div className="stat">
                <div className="k">Sel 100 m</div>
                <div className="v">{int(v.grid.cells)}</div>
                <div className="d">{int(v.grid.cells_in_zone)} di zona genangan</div>
              </div>
              <div className="stat">
                <div className="k">Penduduk sel vs kelurahan</div>
                <div className="v">{(v.grid.diff_pct ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })}%</div>
                <div className="d">
                  {int(v.grid.pop_cells)} vs {int(v.grid.pop_areas)} jiwa (batas 0,5%)
                </div>
              </div>
              <div className="stat">
                <div className="k">TES sah / total</div>
                <div className="v">
                  {int(v.counts.tes_sah)} / {int(v.counts.tes)}
                </div>
                <div className="d">
                  {int(v.counts.kecamatan)} kecamatan, {int(v.counts.kelurahan)} kelurahan
                </div>
              </div>
            </div>
            <div className="grid-2" style={{ gap: 32 }}>
              <div>
                <h3 className="heading-sm" style={{ marginBottom: 8 }}>
                  Sistem koordinat per berkas
                </h3>
                <table className="dt compact">
                  <tbody>
                    {Object.entries(v.crs).map(([k, c]) => (
                      <tr key={k}>
                        <td>{meta.data?.file_kinds[k] ?? k}</td>
                        <td className="mono">{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="heading-sm" style={{ marginBottom: 8 }}>
                  TES bertanda
                </h3>
                {v.shelters.length === 0 ? (
                  <p className="muted">Semua TES sah dan berkapasitas.</p>
                ) : (
                  <table className="dt compact">
                    <thead>
                      <tr>
                        <th>TES</th>
                        <th>Tipe</th>
                        <th>Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.shelters.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>{TYPE_LABEL[s.type]}</td>
                          <td>
                            {s.flag === 'ditolak' && <span className="tag tag-red">Ditolak</span>} {s.flag === 'peringatan' && <span className="tag tag-yellow">Peringatan</span>}{' '}
                            <span className="caption">{s.note}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            {v.population_issues.length > 0 && (
              <details>
                <summary className="row-btn">{v.population_issues.length} kelurahan dengan masalah penduduk</summary>
                <ul>
                  {v.population_issues.map((p) => (
                    <li key={p.code}>
                      {p.name} ({p.code}): {p.issue}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
