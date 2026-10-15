import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { Icon } from './ui'

export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 23c3.5-7 7-10.5 12-10.5S24.5 16 28 23" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="14" y="5" width="4" height="8" fill="#4589ff" />
    </svg>
  )
}

export default function Shell() {
  const { user, can } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [loc.pathname])

  const links = [
    { to: '/', label: 'Dasbor', end: true },
    { to: '/data', label: 'Data' },
    { to: '/skenario', label: 'Skenario' },
    { to: '/bandingkan', label: 'Bandingkan' },
    { to: '/metodologi', label: 'Metodologi' },
    ...(can('admin') ? [{ to: '/admin', label: 'Admin' }] : []),
  ]

  async function logout() {
    await api.post('/auth/logout')
    qc.clear()
    nav('/masuk', { replace: true })
  }

  return (
    <>
      <a href="#main" className="skip-link">
        Lewati ke konten utama
      </a>
      <header className="shell-header">
        <button className="shell-icon-btn shell-menu-btn" aria-label={open ? 'Tutup menu' : 'Buka menu'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'close' : 'menu'} size={20} />
        </button>
        <NavLink to="/" className="brand" aria-label="Sempat, ke dasbor">
          <Logo />
          <b translate="no">Sempat</b>
          <span>Kota Bengkulu</span>
        </NavLink>
        <nav className="shell-nav" aria-label="Navigasi utama">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell-spacer" />
        {user && (
          <div className="shell-user">
            <span className="who">
              <b>{user.name}</b> · {ROLE_LABEL[user.role]}
            </span>
            <button className="shell-icon-btn" onClick={logout} aria-label="Keluar" title="Keluar">
              <Icon name="logout" size={20} />
            </button>
          </div>
        )}
      </header>
      <nav id="mobile-nav" className="mobile-nav" data-open={open} aria-label="Navigasi utama (seluler)">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
