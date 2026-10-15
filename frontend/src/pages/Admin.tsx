import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorNotice, Icon, Loading, Modal, Notice, Tabs, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import type { Role, User } from '../lib/types'

interface AuditRow {
  id: number
  user_email: string | null
  action: string
  object_ref: string
  detail: Record<string, unknown> | null
  at: string
}

const ACTIONS: Record<string, string> = {
  unggah: 'Unggah berkas',
  terbit: 'Terbitkan dataset',
  jalankan: 'Jalankan perhitungan',
  ekspor: 'Ekspor',
  ubah_peran: 'Ubah peran',
  ubah_akun: 'Ubah akun',
  buat_akun: 'Buat akun',
  bagikan: 'Bagikan tautan',
  cabut_tautan: 'Cabut tautan',
  buat_dataset: 'Buat dataset',
  versi_baru: 'Versi dataset baru',
  buat_skenario: 'Buat skenario',
  ubah_skenario: 'Ubah skenario',
  salin_skenario: 'Salin skenario',
  arsip_skenario: 'Arsipkan skenario',
  pulihkan_skenario: 'Pulihkan skenario',
  tambah_intervensi: 'Tambah intervensi',
  batalkan: 'Batalkan run',
}

function Users() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: User[] }>('/users') })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'peneliti' as Role, password: '' })
  const create = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => {
      setOpen(false)
      setForm({ email: '', name: '', role: 'peneliti', password: '' })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<User> }) => api.patch(`/users/${id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) })

  return (
    <div className="stack stack-16">
      <div className="row between">
        <p className="muted">Peran menentukan akses sesuai matriks peran. Tamu tidak memerlukan akun; mereka memakai tautan publik.</p>
        <button className="btn btn-primary btn-md" onClick={() => setOpen(true)}>
          Akun baru <Icon name="add" />
        </button>
      </div>
      {patch.error && <ErrorNotice error={patch.error} />}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Surel</th>
                <th>Peran</th>
                <th>Status</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="mono">{u.email}</td>
                  <td>
                    <label htmlFor={`role-${u.id}`} className="sr-only">
                      Peran {u.name}
                    </label>
                    <select id={`role-${u.id}`} className="select" style={{ minHeight: 32, width: 140 }} value={u.role} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                      {(['admin', 'analis', 'peneliti'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="checkbox">
                      <input type="checkbox" checked={u.active} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, body: { active: e.target.checked } })} />
                      {u.active ? 'Aktif' : 'Nonaktif'}
                    </label>
                  </td>
                  <td>{dateTime(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Akun baru"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>
              Batal
            </button>
            <button className="btn btn-primary" type="submit" form="user-form" disabled={create.isPending}>
              {create.isPending ? 'Membuat…' : 'Buat akun'}
            </button>
          </>
        }
      >
        <form
          id="user-form"
          className="stack stack-16"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          {create.error && <ErrorNotice error={create.error} />}
          <div className="field">
            <label htmlFor="u-name">Nama</label>
            <input id="u-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="u-email">Surel</label>
            <input id="u-email" className="input" type="email" required spellCheck={false} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="u-role">Peran</label>
            <select id="u-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="peneliti">Peneliti</option>
              <option value="analis">Analis</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-pw">Kata sandi awal</label>
            <input id="u-pw" className="input" type="password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            <span className="help">Minimal 10 karakter. Disimpan sebagai hash Argon2.</span>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function Audit() {
  const [action, setAction] = useState('')
  const q = useQuery({ queryKey: ['audit', action], queryFn: () => api.get<{ items: AuditRow[] }>(`/audit${action ? `?action=${action}` : ''}`) })
  return (
    <div className="stack stack-16">
      <Notice kind="info" title="Log audit hanya dapat ditambah.">
        Entri tidak dapat diubah atau dihapus, termasuk oleh Admin. Basis data menolak perubahan lewat pemicu (trigger).
      </Notice>
      <div className="table-toolbar">
        <label htmlFor="act" className="sr-only">
          Saring tindakan
        </label>
        <select id="act" className="select" style={{ width: 'auto' }} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Semua tindakan</option>
          {Object.entries(ACTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNotice error={q.error} />
      ) : (
        <div className="table-wrap">
          <table className="dt compact">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Pelaku</th>
                <th>Tindakan</th>
                <th>Objek</th>
                <th>Rincian</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{dateTime(a.at)}</td>
                  <td className="mono">{a.user_email ?? 'sistem'}</td>
                  <td>{ACTIONS[a.action] ?? a.action}</td>
                  <td className="mono">{a.object_ref.slice(0, 22)}</td>
                  <td className="caption mono" style={{ maxWidth: 360 }}>
                    <div className="truncate" title={a.detail ? JSON.stringify(a.detail) : ''}>
                      {a.detail ? JSON.stringify(a.detail) : '—'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  useDocumentTitle('Admin')
  const [tab, setTab] = useState<'akun' | 'audit'>('akun')
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="headline">Admin</h1>
          <p className="lead">Kelola akun, peran, dan periksa log audit untuk unggah, terbit, jalankan, ekspor, dan perubahan peran.</p>
        </div>
      </div>
      <Tabs
        label="Bagian admin"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'akun', label: 'Akun dan peran' },
          { id: 'audit', label: 'Log audit' },
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ paddingTop: 24 }}>
        {tab === 'akun' ? <Users /> : <Audit />}
      </div>
    </div>
  )
}
