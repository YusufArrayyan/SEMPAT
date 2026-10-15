import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MapView, { MapLegend } from '../components/MapView'
import { RunProgress, RunStatusTag, useRun } from '../components/RunBits'
import { Disclaimer, ErrorNotice, Icon, IkMeter, Loading, Notice, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { KIND_LABEL, MODE_LABEL, dateTime, dec1, dec2, int, pct } from '../lib/format'
import type { Intervention, Layers, Meta, Mode, MonteCarlo, Run, Scenario } from '../lib/types'

type Form = Pick<Scenario, 'name' | 'description' | 'delay_min' | 'arrival_min' | 'mode' | 'speed_ms' | 'night' | 'night_factor' | 'buffer_min' | 'detour_threshold'> & { monte_carlo: MonteCarlo }

const FIELDS = ['name', 'description', 'delay_min', 'arrival_min', 'mode', 'speed_ms', 'night', 'night_factor', 'buffer_min', 'detour_threshold'] as const

function NumField({ id, label, unit, value, onChange, step = 0.5, min = 0, max, help, disabled }: { id: string; label: string; unit: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; help?: string; disabled?: boolean }) {
  const [raw, setRaw] = useState(String(value).replace('.', ','))
  useEffect(() => setRaw(String(value).replace('.', ',')), [value])
  const n = Number(raw.replace(',', '.'))
  const invalid = raw === '' || Number.isNaN(n) || n < min || (max != null && n > max)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          className="input num"
          inputMode="decimal"
          name={id}
          autoComplete="off"
          value={raw}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(e) => {
            setRaw(e.target.value)
            const v = Number(e.target.value.replace(',', '.'))
            if (e.target.value !== '' && !Number.isNaN(v)) onChange(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const v = Math.max(min, Math.round((n + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100)
              onChange(max != null ? Math.min(max, v) : v)
            }
          }}
        />
        <span className="unit">{unit}</span>
      </div>
      {invalid ? <span className="err">Isi angka {min} atau lebih{max != null ? `, paling besar ${max}` : ''}.</span> : help && <span id={`${id}-help`} className="help">{help}</span>}
    </div>
  )
}

function TriField({ label, unit, value, onChange }: { label: string; unit: string; value: number[]; onChange: (v: number[]) => void }) {
  const names = ['Minimum', 'Modus', 'Maksimum']
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="caption muted" style={{ marginBottom: 8 }}>
        {label} ({unit})
      </legend>
      <div className="grid-3" style={{ gap: 8 }}>
        {value.map((v, i) => (
          <div className="field" key={i}>
            <label htmlFor={`${label}-${i}`} className="sr-only">
              {label} {names[i]}
            </label>
            <input
              id={`${label}-${i}`}
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              value={String(v).replace('.', ',')}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'))
                if (!Number.isNaN(n)) onChange(value.map((x, j) => (j === i ? n : x)))
              }}
              aria-label={`${label} ${names[i]}`}
            />
            <span className="help">{names[i]}</span>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

export default function ScenarioEditor() {
  const { id } = useParams()
  const { can } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const editable = can('peneliti')
  const q = useQuery({ queryKey: ['scenario', id], queryFn: () => api.get<Scenario>(`/scenarios/${id}`) })
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: Infinity })
  const s = q.data
  const layers = useQuery({ queryKey: ['layers', s?.dataset_id], queryFn: () => api.get<Layers>(`/datasets/${s!.dataset_id}/layers`), enabled: !!s, staleTime: Infinity })
  const roads = useQuery({ queryKey: ['roads', s?.dataset_id], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/datasets/${s!.dataset_id}/roads`), enabled: !!s, staleTime: Infinity })
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api.get<{ items: Run[] }>(`/runs?scenario_id=${id}`), enabled: !!id })
  useDocumentTitle(s ? s.name : 'Editor skenario')

  const [form, setForm] = useState<Form | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [tool, setTool] = useState<'none' | 'tes' | 'ruas'>('none')
  const [pendingTes, setPendingTes] = useState<{ lon: number; lat: number; name: string; capacity: string } | null>(null)
  const [pendingRoads, setPendingRoads] = useState<{ id: string; name: string }[]>([])
  const [delayCut, setDelayCut] = useState('3')
  const [showMc, setShowMc] = useState(false)

  useEffect(() => {
    if (s && !form) {
      const f: any = {}
      FIELDS.forEach((k) => (f[k] = (s as any)[k]))
      f.monte_carlo = { ...s.monte_carlo }
      setForm(f)
    }
  }, [s])

  // Peringatkan sebelum meninggalkan halaman dengan perubahan belum tersimpan.
  const dirtyRef = useRef(false)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const lastDone = useMemo(() => runs.data?.items.find((r) => r.status === 'selesai' && r.kind !== 'matriks'), [runs.data])
  const active = useRun(activeRunId ?? undefined)
  const shownRun = active.data?.status === 'selesai' ? active.data : lastDone
  const cells = useQuery({ queryKey: ['cells', shownRun?.id], queryFn: () => api.get<GeoJSON.FeatureCollection>(`/runs/${shownRun!.id}/cells`), enabled: !!shownRun, staleTime: Infinity })

  const dirty = useMemo(() => {
    if (!s || !form) return false
    return FIELDS.some((k) => (form as any)[k] !== (s as any)[k]) || JSON.stringify(form.monte_carlo) !== JSON.stringify(s.monte_carlo)
  }, [s, form])

  dirtyRef.current = dirty
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['scenario', id] })
    qc.invalidateQueries({ queryKey: ['scenarios'] })
  }
  const save = useMutation({
    mutationFn: () => api.patch<Scenario>(`/scenarios/${id}`, form),
    onSuccess: (d) => {
      qc.setQueryData(['scenario', id], d)
      qc.invalidateQueries({ queryKey: ['scenarios'] })
    },
  })
  const startRun = useMutation({
    mutationFn: async (kind: 'tunggal' | 'monte_carlo' | 'matriks' | 'intervensi') => {
      if (dirty) {
        const d = await api.patch<Scenario>(`/scenarios/${id}`, form)
        qc.setQueryData(['scenario', id], d)
      }
      if (kind === 'matriks') return api.post<Run>(`/scenarios/${id}/matrix`)
      return api.post<Run>(`/scenarios/${id}/runs`, { kind: kind === 'intervensi' ? 'tunggal' : kind, with_interventions: kind === 'intervensi' })
    },
    onSuccess: (r) => {
      setActiveRunId(r.id)
      qc.invalidateQueries({ queryKey: ['runs', id] })
      refresh()
    },
  })
  const addIv = useMutation({
    mutationFn: (body: { type: Intervention['type']; label: string; payload: any }) => api.post<Intervention>(`/scenarios/${id}/interventions`, body),
    onSuccess: () => {
      setPendingTes(null)
      setPendingRoads([])
      setTool('none')
      refresh()
    },
  })
  const toggleIv = useMutation({ mutationFn: (iv: Intervention) => api.patch(`/interventions/${iv.id}`, { ...iv, enabled: !iv.enabled }), onSuccess: refresh })
  const delIv = useMutation({ mutationFn: (iv: Intervention) => api.del(`/interventions/${iv.id}`), onSuccess: refresh })

  if (q.isLoading || !form)
    return (
      <div className="page">
        {q.error ? <ErrorNotice error={q.error} /> : <Loading />}
      </div>
    )
  if (!s) return null
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f!, [k]: v }))
  const ivs = s.interventions ?? []
  const enabledIvs = ivs.filter((i) => i.enabled)
  const hypo = [
    ...enabledIvs.filter((i) => i.type === 'tambah_tes').map((i) => ({ lon: i.payload.lon, lat: i.payload.lat, name: i.payload.name })),
    ...(pendingTes ? [pendingTes] : []),
  ]
  const blocked = [...enabledIvs.filter((i) => i.type === 'blokir_ruas').flatMap((i) => i.payload.segment_ids as string[]), ...pendingRoads.map((r) => r.id)]
  const running = active.data && !['selesai', 'gagal', 'dibatalkan'].includes(active.data.status)
  const velocity = form.speed_ms * (form.night ? form.night_factor : 1)

  return (
    <div className="workspace">
      <div className="workspace-map">
        <MapView
          label="Peta skenario: hasil terakhir, TES, dan intervensi. Klik peta untuk menaruh TES hipotetis atau memilih ruas jalan saat alat aktif."
          layers={layers.data}
          roads={roads.data}
          cells={cells.data}
          hypothetical={hypo}
          blocked={blocked}
          interact={tool}
          onMapPick={(lon, lat) => setPendingTes({ lon, lat, name: `TES hipotetis ${ivs.filter((i) => i.type === 'tambah_tes').length + 1}`, capacity: '' })}
          onRoadPick={(rid, name) => setPendingRoads((p) => (p.some((x) => x.id === rid) ? p.filter((x) => x.id !== rid) : [...p, { id: rid, name }]))}
        >
          {editable && (
            <div className="map-overlay map-tools" role="toolbar" aria-label="Alat intervensi">
              <button className={`btn btn-sm ${tool === 'tes' ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={tool === 'tes'} onClick={() => setTool(tool === 'tes' ? 'none' : 'tes')}>
                Taruh TES hipotetis
              </button>
              <button className={`btn btn-sm ${tool === 'ruas' ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={tool === 'ruas'} onClick={() => setTool(tool === 'ruas' ? 'none' : 'ruas')}>
                Blokir ruas jalan
              </button>
            </div>
          )}
          {tool !== 'none' && (
            <div className="map-overlay map-hint" role="status">
              {tool === 'tes' ? 'Klik lokasi TES hipotetis pada peta.' : 'Klik ruas jalan untuk memilih atau membatalkan pilihan.'}
            </div>
          )}
          <MapLegend showClasses={!!cells.data}>
            {blocked.length > 0 && (
              <ul style={{ marginTop: 6 }}>
                <li>
                  <span className="mark mark-blokir" aria-hidden="true" /> Ruas diblokir
                </li>
              </ul>
            )}
          </MapLegend>
        </MapView>
      </div>

      <aside className="workspace-panel" aria-label="Panel skenario">
        <Disclaimer />
        <div className="panel-head">
          <nav className="breadcrumb" aria-label="Remah roti">
            <Link to="/skenario">Skenario</Link> <span aria-hidden="true">/</span> <span>Editor</span>
          </nav>
          <label htmlFor="sc-title" className="sr-only">
            Nama skenario
          </label>
          <input id="sc-title" name="name" autoComplete="off" className="input title" style={{ background: 'transparent', padding: '4px 0', fontSize: 24 }} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!editable} />
          <p className="caption muted" style={{ marginTop: 4 }}>
            Dataset {s.dataset?.name} v{s.dataset?.version} · <span className="mono">{s.dataset?.checksum?.slice(0, 10)}</span>
          </p>
        </div>

        <div className="panel-body stack stack-24">
          {shownRun?.summary && (
            <section aria-labelledby="res-title" className="tile-flat stack stack-8" style={{ padding: 16 }}>
              <div className="row between">
                <h2 id="res-title" className="heading-sm">
                  Hasil terakhir · {shownRun.label || KIND_LABEL[shownRun.kind]}
                </h2>
                <Link to={`/hasil/${shownRun.id}`} className="row" style={{ gap: 4 }}>
                  Buka hasil <Icon name="arrow" />
                </Link>
              </div>
              <div className="row" style={{ gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontSize: 32, fontWeight: 300 }} className="num">
                  {pct(shownRun.summary.ik)}
                </span>
                <span className="muted">IK kota</span>
              </div>
              <IkMeter value={shownRun.summary.ik} p5={shownRun.summary.mc?.ik_p5} p95={shownRun.summary.mc?.ik_p95} />
              <p className="caption muted">
                {int(shownRun.summary.pop_late)} jiwa Terlambat dari {int(shownRun.summary.pop_total)} di zona genangan · τ {shownRun.summary.effective_delay_min} mnt, Tₐ {shownRun.params.arrival_min} mnt, {MODE_LABEL[shownRun.params.mode]}
              </p>
            </section>
          )}

          {active.data && <RunProgress run={active.data} onDone={() => qc.invalidateQueries({ queryKey: ['runs', id] })} />}
          {startRun.error && <ErrorNotice error={startRun.error} />}

          <section aria-labelledby="par-title" className="stack stack-16">
            <div className="row between">
              <h2 id="par-title" className="subhead">
                Parameter
              </h2>
              <div className="btn-row">
                {Object.entries(meta.data?.presets ?? {}).map(([k, p]) => (
                  <button
                    key={k}
                    className="btn btn-ghost btn-sm"
                    disabled={!editable}
                    onClick={() => setForm((f) => ({ ...f!, ...Object.fromEntries(FIELDS.filter((x) => x !== 'name' && x !== 'description').map((x) => [x, (p as any)[x]])) }))}
                    title={p.description}
                  >
                    Preset {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <NumField id="p-delay" label="Jeda respons τ" unit="menit" value={form.delay_min} onChange={(v) => set('delay_min', v)} step={1} help="Waktu sebelum warga mulai bergerak." disabled={!editable} />
              <NumField id="p-arr" label="Waktu tiba gelombang Tₐ" unit="menit" value={form.arrival_min} onChange={(v) => set('arrival_min', v)} step={1} min={0.1} disabled={!editable} />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="p-mode">Moda</label>
                <select
                  id="p-mode"
                  className="select"
                  value={form.mode}
                  disabled={!editable}
                  onChange={(e) => {
                    const m = e.target.value as Mode
                    setForm((f) => ({ ...f!, mode: m, speed_ms: meta.data?.default_speeds[m] ?? f!.speed_ms, monte_carlo: { ...f!.monte_carlo, speed: meta.data?.monte_carlo_default.speed[m] ?? f!.monte_carlo.speed } }))
                  }}
                >
                  <option value="jalan_kaki">Jalan kaki</option>
                  <option value="kendaraan">Kendaraan</option>
                </select>
              </div>
              <NumField id="p-speed" label="Kecepatan moda v" unit="m/detik" value={form.speed_ms} onChange={(v) => set('speed_ms', v)} step={0.05} min={0.01} disabled={!editable} />
            </div>
            <div className="grid-2">
              <div className="field">
                <span className="label">Kondisi malam</span>
                <label className="checkbox">
                  <input type="checkbox" checked={form.night} onChange={(e) => set('night', e.target.checked)} disabled={!editable} />
                  Terapkan faktor malam
                </label>
              </div>
              <NumField id="p-night" label="Faktor malam f" unit="×" value={form.night_factor} onChange={(v) => set('night_factor', v)} step={0.05} min={0.05} max={1} disabled={!editable} />
            </div>
            <div className="grid-2">
              <NumField id="p-buf" label="Margin pengaman b" unit="menit" value={form.buffer_min} onChange={(v) => set('buffer_min', v)} step={0.5} help="Batas antara Cukup dan Rawan." disabled={!editable} />
              <NumField id="p-det" label="Ambang rasio jarak" unit="×" value={form.detour_threshold} onChange={(v) => set('detour_threshold', v)} step={0.1} min={1.01} help="Aturan prioritas 3." disabled={!editable} />
            </div>
            <div className="equation" style={{ whiteSpace: 'normal' }}>
              <div>
                v = {form.night ? `${dec2(form.speed_ms)} × ${dec2(form.night_factor)} = ` : ''}
                {dec2(velocity)} m/detik
              </div>
              <div>
                jarak terjangkau sebelum gelombang ≈ ({dec1(form.arrival_min)} − {dec1(form.delay_min)}) × 60 × v = {int(Math.max(0, form.arrival_min - form.delay_min) * 60 * velocity)} m
              </div>
            </div>

            <div>
              <button className="row-btn" onClick={() => setShowMc((v) => !v)} aria-expanded={showMc} aria-controls="mc-cfg">
                {showMc ? 'Sembunyikan' : 'Atur'} sebaran Monte Carlo (N = {int(form.monte_carlo.n)}, benih {form.monte_carlo.seed ?? 'acak'})
              </button>
              {showMc && (
                <div id="mc-cfg" className="stack stack-16" style={{ marginTop: 16 }}>
                  <p className="caption muted">Sebaran segitiga untuk τ, Tₐ, dan v. Benih acak dicatat agar hasil dapat diulang. Rentang Tₐ 10–35 menit perlu diverifikasi sebelum laporan resmi.</p>
                  <TriField label="Jeda τ" unit="menit" value={form.monte_carlo.delay} onChange={(v) => set('monte_carlo', { ...form.monte_carlo, delay: v })} />
                  <TriField label="Waktu tiba Tₐ" unit="menit" value={form.monte_carlo.arrival} onChange={(v) => set('monte_carlo', { ...form.monte_carlo, arrival: v })} />
                  <TriField label="Kecepatan v" unit="m/detik" value={form.monte_carlo.speed} onChange={(v) => set('monte_carlo', { ...form.monte_carlo, speed: v })} />
                  <div className="grid-2">
                    <NumField id="mc-n" label="Jumlah undian N" unit="undian" value={form.monte_carlo.n} onChange={(v) => set('monte_carlo', { ...form.monte_carlo, n: Math.round(v) })} step={100} min={100} max={5000} />
                    <div className="field">
                      <label htmlFor="mc-seed">Benih acak</label>
                      <input
                        id="mc-seed"
                        className="input num"
                        inputMode="numeric"
                        placeholder="Kosong = acak…"
                        value={form.monte_carlo.seed ?? ''}
                        onChange={(e) => set('monte_carlo', { ...form.monte_carlo, seed: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="iv-title" className="stack stack-16">
            <div className="row between">
              <h2 id="iv-title" className="subhead">
                Intervensi
              </h2>
              <span className="caption muted">{enabledIvs.length} aktif</span>
            </div>
            {pendingTes && (
              <div className="tile stack stack-8" style={{ borderColor: 'var(--primary)' }}>
                <h3 className="heading-sm">TES hipotetis baru</h3>
                <p className="mono">
                  {pendingTes.lat.toFixed(5)}, {pendingTes.lon.toFixed(5)}
                </p>
                <div className="grid-2" style={{ gap: 8 }}>
                  <div className="field">
                    <label htmlFor="pt-name">Nama</label>
                    <input id="pt-name" className="input" value={pendingTes.name} onChange={(e) => setPendingTes({ ...pendingTes, name: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="field">
                    <label htmlFor="pt-cap">Kapasitas (jiwa)</label>
                    <input id="pt-cap" autoComplete="off" className="input num" inputMode="numeric" placeholder="Kosong = belum diketahui…" value={pendingTes.capacity} onChange={(e) => setPendingTes({ ...pendingTes, capacity: e.target.value.replace(/\D/g, '') })} />
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn btn-secondary btn-md" onClick={() => setPendingTes(null)}>
                    Batal
                  </button>
                  <button
                    className="btn btn-primary btn-md"
                    disabled={addIv.isPending}
                    onClick={() =>
                      addIv.mutate({
                        type: 'tambah_tes',
                        label: pendingTes.name,
                        payload: { lon: pendingTes.lon, lat: pendingTes.lat, name: pendingTes.name, capacity: pendingTes.capacity ? Number(pendingTes.capacity) : null, type: 'vertikal' },
                      })
                    }
                  >
                    Tambahkan TES
                  </button>
                </div>
              </div>
            )}
            {pendingRoads.length > 0 && (
              <div className="tile stack stack-8" style={{ borderColor: 'var(--error)' }}>
                <h3 className="heading-sm">{pendingRoads.length} ruas dipilih untuk diblokir</h3>
                <p className="caption muted truncate">{[...new Set(pendingRoads.map((r) => r.name || 'Ruas tanpa nama'))].join(', ')}</p>
                <div className="btn-row">
                  <button className="btn btn-secondary btn-md" onClick={() => setPendingRoads([])}>
                    Batal
                  </button>
                  <button
                    className="btn btn-danger btn-md"
                    disabled={addIv.isPending}
                    onClick={() => {
                      const named = pendingRoads.find((r) => r.name)?.name
                      addIv.mutate({ type: 'blokir_ruas', label: named ? `${named} putus` : `${pendingRoads.length} ruas diblokir`, payload: { segment_ids: pendingRoads.map((r) => r.id) } })
                    }}
                  >
                    Blokir ruas
                  </button>
                </div>
              </div>
            )}
            {addIv.error && <ErrorNotice error={addIv.error} />}
            {ivs.length === 0 && !pendingTes && pendingRoads.length === 0 && <p className="muted">Belum ada intervensi. Pakai alat di pojok kiri atas peta, atau turunkan jeda respons di bawah.</p>}
            {ivs.length > 0 && (
              <ul className="list-plain list-rows">
                {ivs.map((iv) => (
                  <li key={iv.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                    <label className="checkbox" style={{ minWidth: 0 }}>
                      <input type="checkbox" checked={iv.enabled} onChange={() => toggleIv.mutate(iv)} disabled={!editable} />
                      <span style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block' }}>
                          {iv.label || iv.type}
                        </span>
                        <span className="caption muted">
                          {iv.type === 'tambah_tes' && `TES hipotetis · kapasitas ${iv.payload.capacity ? int(iv.payload.capacity) : 'belum diketahui'}`}
                          {iv.type === 'blokir_ruas' && `Blokir ${iv.payload.segment_ids.length} ruas`}
                          {iv.type === 'kurangi_jeda' && `Jeda respons turun ${iv.payload.minus_min} menit`}
                        </span>
                      </span>
                    </label>
                    {editable && (
                      <button className="btn btn-ghost btn-sm" onClick={() => window.confirm(`Hapus intervensi “${iv.label || iv.type}”? Hasil lama tetap tersimpan.`) && delIv.mutate(iv)} aria-label={`Hapus intervensi ${iv.label}`}>
                        <Icon name="close" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="iv-delay">Percepat respons (sirene, latihan)</label>
                  <div className="input-unit">
                    <input id="iv-delay" autoComplete="off" className="input num" inputMode="decimal" value={delayCut} onChange={(e) => setDelayCut(e.target.value)} />
                    <span className="unit">menit lebih cepat</span>
                  </div>
                </div>
                <button
                  className="btn btn-tertiary btn-md"
                  disabled={addIv.isPending || !(Number(delayCut.replace(',', '.')) > 0)}
                  onClick={() => {
                    const m = Number(delayCut.replace(',', '.'))
                    addIv.mutate({ type: 'kurangi_jeda', label: `Jeda dipercepat ${m} menit`, payload: { minus_min: m } })
                  }}
                >
                  Tambah
                </button>
              </div>
            )}
          </section>

          {editable && (
            <section aria-labelledby="run-title" className="stack stack-8">
              <h2 id="run-title" className="subhead">
                Jalankan
              </h2>
              {dirty && <p className="caption" style={{ color: '#8e6a00' }}>Ada perubahan belum tersimpan; perubahan disimpan otomatis saat dijalankan.</p>}
              <div className="stack" style={{ gap: 1 }}>
                <button className="btn btn-primary" onClick={() => startRun.mutate('tunggal')} disabled={!!running || startRun.isPending}>
                  Jalankan skenario dasar <Icon name="play" />
                </button>
                <button className="btn btn-secondary" onClick={() => startRun.mutate('intervensi')} disabled={!!running || startRun.isPending || enabledIvs.length === 0} title={enabledIvs.length === 0 ? 'Tambahkan intervensi terlebih dahulu' : undefined}>
                  Uji {enabledIvs.length} intervensi terhadap dasar <Icon name="compare" />
                </button>
                <div className="grid-2" style={{ gap: 1 }}>
                  <button className="btn btn-tertiary" onClick={() => startRun.mutate('matriks')} disabled={!!running || startRun.isPending}>
                    Matriks 12
                  </button>
                  <button className="btn btn-tertiary" onClick={() => startRun.mutate('monte_carlo')} disabled={!!running || startRun.isPending}>
                    Monte Carlo
                  </button>
                </div>
              </div>
              {dirty && (
                <button className="btn btn-ghost btn-md" onClick={() => save.mutate()} disabled={save.isPending}>
                  Simpan tanpa menjalankan
                </button>
              )}
              {save.error && <ErrorNotice error={save.error} />}
              {active.data?.status === 'selesai' && (
                <Notice
                  kind="success"
                  title="Perhitungan selesai."
                  action={
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => nav(active.data!.with_interventions && active.data!.base_run_id ? `/bandingkan?a=${active.data!.base_run_id}&b=${active.data!.id}` : `/hasil/${active.data!.id}`)}
                    >
                      {active.data.with_interventions ? 'Lihat selisih' : 'Lihat hasil'}
                    </button>
                  }
                >
                  Selesai dalam {dec2(active.data.duration_s)} detik.
                </Notice>
              )}
            </section>
          )}

          <section aria-labelledby="hist-title">
            <h2 id="hist-title" className="subhead" style={{ marginBottom: 12 }}>
              Riwayat perhitungan
            </h2>
            {runs.data?.items.length ? (
              <ul className="list-plain list-rows">
                {runs.data.items.slice(0, 12).map((r) => (
                  <li key={r.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <Link to={r.with_interventions && r.base_run_id && r.status === 'selesai' ? `/bandingkan?a=${r.base_run_id}&b=${r.id}` : `/hasil/${r.id}`}>{r.label || KIND_LABEL[r.kind]}</Link>
                      <div className="caption muted">
                        {dateTime(r.created_at)}
                        {r.summary && r.kind !== 'matriks' && ` · IK ${pct(r.summary.ik)}`}
                      </div>
                    </div>
                    <RunStatusTag status={r.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Belum ada perhitungan untuk skenario ini.</p>
            )}
          </section>

          <details>
            <summary className="row-btn">Jejak perubahan parameter ({s.history.length})</summary>
            <ul className="list-plain list-rows" style={{ marginTop: 12 }}>
              {[...s.history].reverse().map((h, i) => (
                <li key={i} className="caption">
                  <b>{h.change}</b> oleh {h.by} · {dateTime(h.at)}
                  {h.values && h.change === 'ubah' && (
                    <div className="muted">
                      {Object.entries(h.values as Record<string, { dari: any; ke: any }>)
                        .map(([k, v]) => `${k}: ${typeof v.dari === 'object' ? '…' : v.dari} → ${typeof v.ke === 'object' ? '…' : v.ke}`)
                        .join('; ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </aside>
    </div>
  )
}
