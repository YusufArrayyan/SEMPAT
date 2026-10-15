import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RunStatusTag } from '../components/RunBits'
import { Empty, ErrorNotice, Icon, IkMeter, Loading, Modal, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { MODE_LABEL, date, dec1, pct } from '../lib/format'
import type { Meta, Scenario } from '../lib/types'

export default function Scenarios() {
  useDocumentTitle('Skenario')
  const { can } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [archived, setArchived] = useState(params.get('arsip') === '1')
  const [filter, setFilter] = useState('')
  const q = useQuery({ queryKey: ['scenarios', archived], queryFn: () => api.get<{ items: Scenario[] }>(`/scenarios?include_archived=${archived}`) })
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: Infinity })
  const [open, setOpen] = useState(params.get('baru') === '1')
  const [preset, setPreset] = useState('esai_2026')
  const [name, setName] = useState('')

  useEffect(() => {
    if (params.get('baru') === '1') setOpen(true)
  }, [params])

  const create = useMutation({
    mutationFn: () => api.post<Scenario>('/scenarios', { preset, name: name.trim() || undefined }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['scenarios'] })
      nav(`/skenario/${s.id}`)
    },
  })
  const copy = useMutation({
    mutationFn: (id: string) => api.post<Scenario>(`/scenarios/${id}/copy`),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['scenarios'] })
      nav(`/skenario/${s.id}`)
    },
  })
  const archive = useMutation({
    mutationFn: (id: string) => api.post<Scenario>(`/scenarios/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios'] }),
  })

  const items = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (q.data?.items ?? []).filter((s) => !f || s.name.toLowerCase().includes(f))
  }, [q.data, filter])

  function close() {
    setOpen(false)
    if (params.get('baru')) {
      params.delete('baru')
      setParams(params, { replace: true })
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="headline">Skenario</h1>
          <p className="lead">Setiap skenario menyimpan parameter rumus sisa waktu dan intervensi. Hasil lama tetap tersimpan dan dapat dibandingkan.</p>
        </div>
        {can('peneliti') && (
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            Buat skenario <Icon name="add" />
          </button>
        )}
      </div>

      <div className="table-toolbar">
        <label htmlFor="sc-filter" className="sr-only">
          Saring skenario
        </label>
        <input id="sc-filter" className="input" type="search" placeholder="Saring menurut nama…" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
        <label className="checkbox" style={{ padding: '0 16px' }}>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked)
              e.target.checked ? params.set('arsip', '1') : params.delete('arsip')
              setParams(params, { replace: true })
            }}
          />
          Tampilkan arsip
        </label>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <Empty title={filter ? 'Tidak ada skenario yang cocok' : 'Belum ada skenario'} action={!filter && can('peneliti') && <button className="btn btn-primary" onClick={() => setOpen(true)}>Buat skenario</button>}>
          {filter ? 'Ubah kata saringan.' : 'Mulai dari preset “Esai 2026” atau “Fachri 2022”.'}
        </Empty>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Skenario</th>
                <th className="r">τ</th>
                <th className="r">Tₐ</th>
                <th>Moda</th>
                <th>IK kota (terakhir)</th>
                <th>Status</th>
                <th>Pembuat</th>
                <th>Diubah</th>
                <th>
                  <span className="sr-only">Tindakan</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const r = s.last_completed_run
                return (
                  <tr key={s.id}>
                    <td style={{ maxWidth: 320 }}>
                      <Link to={`/skenario/${s.id}`} className="truncate" style={{ display: 'block' }}>
                        {s.name}
                      </Link>
                      {s.archived && <span className="tag">Arsip</span>}
                    </td>
                    <td className="r">{dec1(s.delay_min)}</td>
                    <td className="r">{dec1(s.arrival_min)}</td>
                    <td>
                      {MODE_LABEL[s.mode]}
                      {s.night && ' · malam'}
                    </td>
                    <td>
                      {r?.summary && r.kind !== 'matriks' ? (
                        <Link to={`/hasil/${r.id}`} className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="num" style={{ width: 52 }}>
                            {pct(r.summary.ik)}
                          </span>
                          <span style={{ width: 80 }}>
                            <IkMeter value={r.summary.ik} />
                          </span>
                        </Link>
                      ) : (
                        <span className="muted">Belum dihitung</span>
                      )}
                    </td>
                    <td>{s.last_run ? <RunStatusTag status={s.last_run.status} /> : '—'}</td>
                    <td>{s.created_by ?? '—'}</td>
                    <td className="nowrap">{date(s.updated_at)}</td>
                    <td>
                      {can('peneliti') && (
                        <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => copy.mutate(s.id)} aria-label={`Salin ${s.name}`} title="Salin">
                            <Icon name="copy" />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => archive.mutate(s.id)} aria-label={s.archived ? `Pulihkan ${s.name}` : `Arsipkan ${s.name}`} title={s.archived ? 'Pulihkan' : 'Arsipkan'}>
                            <Icon name="archive" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Buat skenario"
        footer={
          <>
            <button className="btn btn-secondary" onClick={close}>
              Batal
            </button>
            <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Membuat…' : 'Buat dan buka editor'}
            </button>
          </>
        }
      >
        <div className="stack stack-16">
          {create.error && <ErrorNotice error={create.error} />}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack stack-8">
            <legend className="caption muted" style={{ marginBottom: 8 }}>
              Preset parameter
            </legend>
            {Object.entries(meta.data?.presets ?? {}).map(([k, p]) => (
              <label key={k} className="tile" style={{ display: 'flex', gap: 12, cursor: 'pointer', padding: 16, borderColor: preset === k ? 'var(--ink)' : undefined }}>
                <input type="radio" name="preset" value={k} checked={preset === k} onChange={() => setPreset(k)} />
                <span>
                  <span className="heading-sm" style={{ display: 'block' }}>
                    {p.label}
                  </span>
                  <span className="caption muted">{p.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="sc-name">Nama skenario (opsional)</label>
            <input id="sc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Malam hari, jeda 10 menit…" autoComplete="off" />
          </div>
          <p className="caption muted">Skenario memakai dataset terbit terbaru. Semua nilai dapat diubah di editor, dan setiap perubahan tercatat.</p>
        </div>
      </Modal>
    </div>
  )
}
