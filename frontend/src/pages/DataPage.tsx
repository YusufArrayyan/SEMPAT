import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, ErrorNotice, Icon, Loading, Modal, Notice, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { DS_STATUS, dateTime, int } from '../lib/format'
import type { Dataset } from '../lib/types'

export function DatasetMetaFields({ v, set, disabled }: { v: Partial<Dataset>; set: (k: keyof Dataset, val: any) => void; disabled?: boolean }) {
  return (
    <div className="stack stack-16">
      <div className="field">
        <label htmlFor="ds-name">Nama dataset</label>
        <input id="ds-name" className="input" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} disabled={disabled} required minLength={3} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="ds-source">Sumber data</label>
        <textarea id="ds-source" className="textarea" value={v.source ?? ''} onChange={(e) => set('source', e.target.value)} disabled={disabled} placeholder="Contoh: TES dari BPBD Kota Bengkulu; jalan dari Ina-Geoportal…" />
        <span className="help">Wajib sebelum terbit. Catat asal setiap berkas.</span>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="ds-license">Lisensi</label>
          <input id="ds-license" className="input" value={v.license ?? ''} onChange={(e) => set('license', e.target.value)} disabled={disabled} placeholder="Contoh: CC BY 4.0…" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="ds-acc">Tanggal akses</label>
          <input id="ds-acc" className="input" type="date" value={v.accessed_at ?? ''} onChange={(e) => set('accessed_at', e.target.value)} disabled={disabled} />
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={!!v.license_open} onChange={(e) => set('license_open', e.target.checked)} disabled={disabled} />
        Lisensi terbuka: hasil boleh dibagikan lewat tautan publik
      </label>
    </div>
  )
}

export default function DataPage() {
  useDocumentTitle('Data')
  const { can } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['datasets'], queryFn: () => api.get<{ items: Dataset[] }>('/datasets') })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<Dataset>>({ name: '', source: '', license: '', license_open: false, accessed_at: new Date().toISOString().slice(0, 10) })
  const create = useMutation({
    mutationFn: () => api.post<Dataset>('/datasets', form),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      nav(`/data/${d.id}`)
    },
  })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="headline">Data</h1>
          <p className="lead">Impor berkas, periksa laporan validasi, lalu terbitkan versi dataset. Dataset terbit dibekukan dan diberi hash; koreksi selalu membuat versi baru.</p>
        </div>
        {can('peneliti') && (
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            Dataset baru <Icon name="add" />
          </button>
        )}
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && (
        <Empty title="Belum ada dataset" action={can('peneliti') && <button className="btn btn-primary" onClick={() => setOpen(true)}>Buat dataset</button>}>
          Buat dataset, unggah enam jenis berkas, jalankan validasi, lalu terbitkan.
        </Empty>
      )}
      {q.data && q.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Versi</th>
                <th>Status</th>
                <th className="r">Sel di zona</th>
                <th className="r">TES sah</th>
                <th>Hash</th>
                <th>Terbit</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/data/${d.id}`}>{d.name}</Link>
                    {d.has_errors && <span className="tag tag-red" style={{ marginLeft: 8 }}>Ada galat</span>}
                  </td>
                  <td className="num">v{d.version}</td>
                  <td>
                    <span className={`tag ${DS_STATUS[d.status][1]}`}>{DS_STATUS[d.status][0]}</span>
                  </td>
                  <td className="r">{int(d.stats?.cells_in_zone)}</td>
                  <td className="r">{int(d.stats?.tes_sah)}</td>
                  <td className="mono">{d.checksum ? d.checksum.slice(0, 12) : '—'}</td>
                  <td>{d.published_at ? dateTime(d.published_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Notice kind="info" title="Format berkas yang diterima">
        <ul>
          <li>TES: CSV atau GeoJSON titik — kolom nama, lon, lat, tipe (vertikal, dataran_tinggi, tak_diketahui), kapasitas (opsional), status.</li>
          <li>Jaringan jalan: GeoJSON garis atau Shapefile ZIP.</li>
          <li>Batas wilayah: GeoJSON poligon — kode, nama, tingkat (kecamatan/kelurahan), kode_induk untuk kelurahan.</li>
          <li>Penduduk: CSV — kode, penduduk, tahun.</li>
          <li>Zona genangan dan sirene: GeoJSON. Koordinat dinormalkan ke EPSG:4326; perhitungan memakai EPSG:32748.</li>
        </ul>
        <p style={{ marginTop: 8 }}>Batas unggahan 100 MB per berkas. Contoh berkas ada di folder <span className="mono">backend/sample_data</span>.</p>
      </Notice>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Dataset baru"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>
              Batal
            </button>
            <button className="btn btn-primary" form="ds-form" type="submit" disabled={create.isPending || (form.name ?? '').length < 3}>
              {create.isPending ? 'Membuat…' : 'Buat dataset'}
            </button>
          </>
        }
      >
        <form
          id="ds-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate()
          }}
          className="stack stack-16"
        >
          {create.error && <ErrorNotice error={create.error} />}
          <DatasetMetaFields v={form} set={(k, val) => setForm((f) => ({ ...f, [k]: val }))} />
        </form>
      </Modal>
    </div>
  )
}
