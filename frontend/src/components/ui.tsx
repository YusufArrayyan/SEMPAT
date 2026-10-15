import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { CLS_DESC, CLS_LABEL, CLS_ORDER } from '../lib/format'
import type { Cls } from '../lib/types'

/* Ikon garis sederhana 16 px (gaya Carbon). aria-hidden: makna dibawa teks. */
const PATHS: Record<string, string> = {
  arrow: 'M9.3 3.3 8.6 4l3.5 3.5H2v1h10.1L8.6 12l.7.7L14 8z',
  back: 'M6.7 3.3 7.4 4 3.9 7.5H14v1H3.9L7.4 12l-.7.7L2 8z',
  play: 'M4 2.5v11l9-5.5z',
  add: 'M8.5 7.5V3h-1v4.5H3v1h4.5V13h1V8.5H13v-1z',
  close: 'M12 4.7 11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3l.7.7L8 8.7l3.3 3.3.7-.7L8.7 8z',
  download: 'M13 12v2H3v-2H2v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2zM12.7 7.7 12 7l-3.5 3.5V1h-1v9.5L4 7l-.7.7L8 12.4z',
  upload: 'M3 11v2h10v-2h1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2zM3.3 5.3 4 6l3.5-3.5V12h1V2.5L12 6l.7-.7L8 .6z',
  warning: 'M8 1 1 14h14zm0 2.1L13.3 13H2.7zM7.5 6h1v4h-1zm.5 5.2a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z',
  error: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12m-.5-10h1v5h-1zM8 10.3a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4',
  info: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12M7.5 7h1v5h-1zM8 4.3a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4',
  check: 'M6.5 11.3 3 7.8l.7-.7 2.8 2.8 5.8-5.8.7.7z',
  menu: 'M2 4h12v1H2zm0 3.5h12v1H2zM2 11h12v1H2z',
  logout: 'M3 2h6v1H3v10h6v1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1m8.3 3.3L12 4.6 15.4 8 12 11.4l-.7-.7 2.2-2.2H6v-1h7.5z',
  copy: 'M13 4H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1m0 9H6V5h7zM3 2h7v1H3v8H2V3a1 1 0 0 1 1-1',
  archive: 'M14 2H2v3h1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5h1zm-2 11H4V5h8zm1-9H3V3h10zM6 7h4v1H6z',
  stop: 'M4 4h8v8H4z',
  compare: 'M2 2h5v12H2zm1 1v10h3V3zm6-1h5v12H9zm1 1v10h3V3z',
  link: 'M9.6 3.3a2.6 2.6 0 0 1 3.7 3.7l-2.2 2.2-.7-.7 2.2-2.2a1.6 1.6 0 0 0-2.3-2.3L8.1 6.2l-.7-.7zM6.4 12.7a2.6 2.6 0 1 1-3.7-3.7l2.2-2.2.7.7-2.2 2.2a1.6 1.6 0 0 0 2.3 2.3l2.2-2.2.7.7zm-.3-3.5 3.1-3.1.7.7-3.1 3.1z',
  map: 'M10 2.5 6 1 1 3v12l5-2 4 1.5L15 13V1zM6 12 2 13.6V3.7L6 2.1zm4 1.4-3-1.1V2.6l3 1.1zm4-1.1-3 1.2V3.7l3-1.3z',
  filter: 'M2 3h12v1.5l-4.5 5V14l-3-1.5v-3L2 4.5z',
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}

export function Notice({ kind = 'info', title, children, action }: { kind?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const icon = kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : kind === 'success' ? 'check' : 'info'
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div className="notice-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null
  return (
    <Notice
      kind="error"
      title={e?.message ?? 'Terjadi galat yang tidak terduga.'}
      action={
        onRetry && (
          <button className="btn btn-ghost btn-sm" onClick={onRetry}>
            Coba lagi
          </button>
        )
      }
    >
      {e?.hint || (!e && 'Muat ulang halaman. Bila berulang, hubungi Admin.')}
    </Notice>
  )
}

export function Disclaimer() {
  return (
    <p className="disclaimer">
      <Icon name="info" />
      <span>Hasil adalah uji kecukupan tempat evakuasi pada skenario terpilih, bukan prediksi tsunami.</span>
    </p>
  )
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />
}

export function Loading({ label = 'Memuat…', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="stack stack-8" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={i === 0 ? 28 : 16} w={i === 0 ? '40%' : `${90 - i * 8}%`} />
      ))}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ClsLabel({ cls }: { cls: Cls }) {
  return (
    <span className="cls-label">
      <span className={`swatch swatch-${cls}`} aria-hidden="true" />
      {CLS_LABEL[cls]}
    </span>
  )
}

export function ClassLegendList({ counts }: { counts?: Partial<Record<Cls, string>> }) {
  return (
    <ul>
      {CLS_ORDER.map((c) => (
        <li key={c} title={CLS_DESC[c]}>
          <span className={`swatch swatch-${c}`} aria-hidden="true" />
          <span style={{ flex: 1 }}>{CLS_LABEL[c]}</span>
          {counts?.[c] && <span className="num muted">{counts[c]}</span>}
        </li>
      ))}
    </ul>
  )
}

export function IkMeter({ value, p5, p95 }: { value: number | null; p5?: number | null; p95?: number | null }) {
  if (value == null) return <span className="muted">—</span>
  return (
    <div className="ik-meter" role="img" aria-label={`Indeks kecukupan ${Math.round(value * 100)} persen`}>
      <span style={{ width: `${value * 100}%` }} />
      {p5 != null && p95 != null && <i style={{ left: `${p5 * 100}%`, width: `${Math.max(1, (p95 - p5) * 100)}%` }} />}
    </div>
  )
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ transform: `scaleX(${Math.max(0.03, value)})` }} />
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          role="tab"
          id={`tab-${t.id}`}
          aria-controls={`panel-${t.id}`}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            onChange(tabs[n].id)
            refs.current[n]?.focus()
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="modal-title">
      <div className="modal-head row between">
        <h2 id="modal-title" className="subhead">
          {title}
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Tutup">
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  )
}

export function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      <span aria-live="polite">{done ? 'Tersalin' : label}</span>
      <Icon name={done ? 'check' : 'copy'} />
    </button>
  )
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — Sempat`
  }, [title])
}
