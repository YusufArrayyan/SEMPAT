import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/Shell'
import { Icon, Notice, useDocumentTitle } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function Login() {
  useDocumentTitle('Masuk')
  const { user } = useAuth()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const next = params.get('ke') || '/'

  if (user) return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError(new ApiError(0, 'kosong', 'Isi surel dan kata sandi.', 'Kedua kolom wajib diisi.'))
      document.getElementById(!email ? 'email' : 'password')?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/login', { email, password })
      await qc.invalidateQueries({ queryKey: ['me'] })
      nav(next.startsWith('/') ? next : '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'galat', 'Gagal masuk.', 'Coba lagi.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-art" aria-label="Tentang Sempat">
        <div className="row" style={{ gap: 10 }}>
          <Logo />
          <b style={{ fontWeight: 600 }}>Sempat</b>
          <span style={{ color: 'var(--inverse-muted)' }}>v1.0</span>
        </div>
        <div style={{ maxWidth: 520 }}>
          <p className="caption" style={{ color: 'var(--inverse-muted)', marginBottom: 16 }}>
            Uji kecukupan tempat evakuasi sementara · Kota Bengkulu
          </p>
          <h1 className="display" style={{ color: '#fff' }}>
            Dari setiap sel permukiman, apakah warga sempat mencapai TES sebelum gelombang tiba?
          </h1>
          <p className="equation" style={{ marginTop: 24, background: 'var(--inverse-2)', color: '#fff' }}>
            sisa waktu = T<sub>a</sub> − (τ + d / 60v)
          </p>
        </div>
        <p className="caption" style={{ color: 'var(--inverse-muted)', maxWidth: 520 }}>
          Sistem ini bukan sistem peringatan dini, tidak memprediksi tsunami, dan tidak memberi arahan rute kepada warga. Hasilnya adalah uji kecukupan pada skenario terpilih untuk
          mendukung kajian BPBD.
        </p>
      </section>
      <section className="login-form" aria-labelledby="login-title">
        <h2 id="login-title" className="headline" style={{ marginBottom: 8 }}>
          Masuk
        </h2>
        <p className="muted" style={{ marginBottom: 32 }}>
          Gunakan akun yang dibuat Admin. Tamu dengan tautan publik tidak perlu masuk.
        </p>
        <form onSubmit={submit} className="stack stack-24" noValidate>
          {error && (
            <Notice kind="error" title={error.message}>
              {error.hint}
            </Notice>
          )}
          <div className="field">
            <label htmlFor="email">Surel</label>
            <input
              id="email"
              className="input input-lg"
              type="email"
              name="email"
              autoComplete="username"
              spellCheck={false}
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@instansi.go.id…"
              aria-invalid={!!error}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Kata sandi</label>
            <input
              id="password"
              className="input input-lg"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            <span>{busy ? 'Memeriksa…' : 'Masuk'}</span>
            <Icon name="arrow" />
          </button>
        </form>
        <p className="caption muted" style={{ marginTop: 32 }}>
          Penggunaan: hasil Sempat adalah uji kecukupan skenario dan tidak menggantikan kajian teknis BPBD. Akun contoh untuk pengembangan lokal tercantum di README proyek.
        </p>
      </section>
    </div>
  )
}
