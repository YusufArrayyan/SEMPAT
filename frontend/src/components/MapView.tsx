import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CLS_COLOR } from '../lib/format'
import type { Cls, Layers } from '../lib/types'

// Worker MapLibre v6 dibundel Vite agar impor relatifnya tidak putus saat pre-bundle.
maplibregl.setWorkerUrl(workerUrl)

type FC = GeoJSON.FeatureCollection
const EMPTY: FC = { type: 'FeatureCollection', features: [] }

export interface MapViewState {
  center: [number, number]
  zoom: number
}

export interface MapViewProps {
  label: string
  layers?: Layers | null
  roads?: FC | null
  cells?: FC | null
  route?: GeoJSON.Feature | null
  /** Bila diisi, peta bergeser agar rute/sel terpilih tampak penuh. */
  focusRoute?: boolean
  selectedCell?: number | null
  hypothetical?: { lon: number; lat: number; name: string }[]
  blocked?: string[]
  interact?: 'none' | 'tes' | 'ruas'
  onCellClick?: (id: number) => void
  onMapPick?: (lon: number, lat: number) => void
  onRoadPick?: (id: string, name: string) => void
  view?: MapViewState | null
  onViewChange?: (v: MapViewState) => void
  visible?: Partial<Record<'roads' | 'kelurahan' | 'zones' | 'sirens' | 'shelters' | 'cells', boolean>>
  children?: ReactNode
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'laut', type: 'background', paint: { 'background-color': '#dbe5ef' } }],
}

/** Pola isi agar kelas terbaca tanpa warna (NFR-07). */
function patternImage(cls: Cls | 'disembunyikan'): { width: number; height: number; data: Uint8Array } {
  const s = 16
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = cls === 'disembunyikan' ? '#e8e8e8' : CLS_COLOR[cls]
  g.fillRect(0, 0, s, s)
  if (cls === 'disembunyikan') {
    g.fillStyle = '#a8a8a8'
    g.fillRect(0, 7, s, 2)
  }
  if (cls === 'rawan') {
    g.strokeStyle = 'rgba(22,22,22,0.55)'
    g.lineWidth = 2
    for (let o = -s; o <= s; o += 8) {
      g.beginPath()
      g.moveTo(o, s)
      g.lineTo(o + s, 0)
      g.stroke()
    }
  } else if (cls === 'terlambat') {
    g.fillStyle = 'rgba(255,255,255,0.85)'
    for (const [x, y] of [
      [4, 4],
      [12, 12],
    ]) {
      g.beginPath()
      g.arc(x, y, 1.8, 0, Math.PI * 2)
      g.fill()
    }
  } else if (cls === 'terputus') {
    g.strokeStyle = 'rgba(255,255,255,0.8)'
    g.lineWidth = 1.5
    for (let o = -s; o <= s; o += 8) {
      g.beginPath()
      g.moveTo(o, s)
      g.lineTo(o + s, 0)
      g.stroke()
      g.beginPath()
      g.moveTo(o, 0)
      g.lineTo(o + s, s)
      g.stroke()
    }
  }
  const d = g.getImageData(0, 0, s, s)
  return { width: s, height: s, data: new Uint8Array(d.data.buffer) }
}

function iconImage(kind: 'vertikal' | 'dataran_tinggi' | 'tak_diketahui' | 'hipotetis' | 'ditolak'): { width: number; height: number; data: Uint8Array } {
  const s = 40
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.lineWidth = 4
  g.strokeStyle = '#ffffff'
  g.fillStyle = kind === 'hipotetis' ? '#0f62fe' : kind === 'ditolak' ? '#da1e28' : '#161616'
  g.beginPath()
  if (kind === 'vertikal') {
    g.moveTo(20, 4)
    g.lineTo(36, 34)
    g.lineTo(4, 34)
  } else if (kind === 'dataran_tinggi') {
    g.rect(7, 7, 26, 26)
  } else if (kind === 'hipotetis') {
    g.moveTo(20, 3)
    g.lineTo(37, 20)
    g.lineTo(20, 37)
    g.lineTo(3, 20)
  } else if (kind === 'ditolak') {
    g.rect(7, 7, 26, 26)
  } else {
    g.arc(20, 20, 14, 0, Math.PI * 2)
  }
  g.closePath()
  g.stroke()
  g.fill()
  if (kind === 'tak_diketahui') {
    g.fillStyle = '#fff'
    g.font = 'bold 20px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('?', 20, 21)
  }
  if (kind === 'ditolak') {
    g.strokeStyle = '#fff'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(13, 13)
    g.lineTo(27, 27)
    g.moveTo(27, 13)
    g.lineTo(13, 27)
    g.stroke()
  }
  const d = g.getImageData(0, 0, s, s)
  return { width: s, height: s, data: new Uint8Array(d.data.buffer) }
}

export default function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const cb = useRef(props)
  cb.current = props
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: [102.29, -3.81],
      zoom: 11.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 18,
    })
    m.touchZoomRotate.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Data contoh sintetis · Sempat' }), 'bottom-right')
    map.current = m

    m.on('load', () => {
      for (const c of ['cukup', 'rawan', 'terlambat', 'terputus', 'disembunyikan'] as const) m.addImage(`pat-${c}`, patternImage(c), { pixelRatio: 2 })
      for (const k of ['vertikal', 'dataran_tinggi', 'tak_diketahui', 'hipotetis', 'ditolak'] as const) m.addImage(`ic-${k}`, iconImage(k), { pixelRatio: 2 })
      for (const id of ['kecamatan', 'kelurahan', 'zones', 'roads', 'cells', 'route', 'shelters', 'sirens', 'hypo']) m.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'cells' || id === 'roads' ? { promoteId: 'id' } : {}) })

      m.addLayer({ id: 'darat', type: 'fill', source: 'kecamatan', paint: { 'fill-color': '#ffffff' } })
      m.addLayer({ id: 'zona-isi', type: 'fill', source: 'zones', paint: { 'fill-color': '#0f62fe', 'fill-opacity': 0.06 } })
      m.addLayer({ id: 'kel-garis', type: 'line', source: 'kelurahan', minzoom: 12.5, paint: { 'line-color': '#a8a8a8', 'line-width': 0.8, 'line-dasharray': [2, 2] } })
      m.addLayer({
        id: 'jalan',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': ['match', ['get', 'class'], 'arteri', '#8d8d8d', 'pesisir', '#8d8d8d', 'jembatan', '#525252', '#b4b4b4'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'class'], 'arteri', 1.2, 'jembatan', 2, 0.5], 16, ['match', ['get', 'class'], 'arteri', 5, 'jembatan', 6, 2.5]],
        },
      })
      m.addLayer({ id: 'sel', type: 'fill', source: 'cells', paint: { 'fill-pattern': ['concat', 'pat-', ['get', 'kelas']], 'fill-opacity': 0.88 } })
      m.addLayer({ id: 'sel-garis', type: 'line', source: 'cells', minzoom: 14, paint: { 'line-color': '#ffffff', 'line-width': 0.4 } })
      m.addLayer({ id: 'sel-pilih', type: 'line', source: 'cells', filter: ['==', ['id'], -1], paint: { 'line-color': '#161616', 'line-width': 3 } })
      m.addLayer({ id: 'kec-garis', type: 'line', source: 'kecamatan', paint: { 'line-color': '#6f6f6f', 'line-width': 1.6 } })
      m.addLayer({ id: 'zona-garis', type: 'line', source: 'zones', paint: { 'line-color': '#0043ce', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'jalan-blokir', type: 'line', source: 'roads', filter: ['in', ['get', 'id'], ['literal', []]], paint: { 'line-color': '#da1e28', 'line-width': 6 } })
      m.addLayer({ id: 'rute-tepi', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } })
      m.addLayer({ id: 'rute', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0f62fe', 'line-width': 4 } })
      m.addLayer({ id: 'sirene', type: 'circle', source: 'sirens', paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#161616', 'circle-stroke-width': 2 } })
      m.addLayer({
        id: 'tes',
        type: 'symbol',
        source: 'shelters',
        layout: {
          'icon-image': ['case', ['==', ['get', 'flag'], 'ditolak'], 'ic-ditolak', ['concat', 'ic-', ['get', 'type']]],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1],
          'icon-allow-overlap': true,
        },
      })
      m.addLayer({ id: 'tes-hipotetis', type: 'symbol', source: 'hypo', layout: { 'icon-image': 'ic-hipotetis', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 15, 1.1], 'icon-allow-overlap': true } })
      // Atribusi dimulai terlipat agar tidak menutupi peta di layar sempit.
      el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      setReady(true)
    })

    m.on('click', (e) => {
      const p = cb.current
      if (p.interact === 'tes') {
        p.onMapPick?.(e.lngLat.lng, e.lngLat.lat)
        return
      }
      if (p.interact === 'ruas') {
        const bb: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ]
        const f = m.queryRenderedFeatures(bb, { layers: ['jalan'] })[0]
        if (f) p.onRoadPick?.(String(f.properties?.id), String(f.properties?.name || ''))
        return
      }
      const f = m.queryRenderedFeatures(e.point, { layers: ['sel'] })[0]
      if (f && p.onCellClick) p.onCellClick(Number(f.id ?? f.properties?.id))
    })
    m.on('mousemove', (e) => {
      const p = cb.current
      let pointer = false
      if (p.interact === 'tes') pointer = true
      else if (p.interact === 'ruas') pointer = m.queryRenderedFeatures([
        [e.point.x - 6, e.point.y - 6],
        [e.point.x + 6, e.point.y + 6],
      ], { layers: ['jalan'] }).length > 0
      else if (p.onCellClick) pointer = m.queryRenderedFeatures(e.point, { layers: ['sel'] }).length > 0
      m.getCanvas().style.cursor = p.interact === 'tes' ? 'crosshair' : pointer ? 'pointer' : ''
    })
    m.on('moveend', (e) => {
      if (!(e as any).originalEvent) return
      const c = m.getCenter()
      cb.current.onViewChange?.({ center: [c.lng, c.lat], zoom: m.getZoom() })
    })
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  const set = (id: string, data: FC | GeoJSON.Feature | null | undefined) => {
    const s = map.current?.getSource(id) as GeoJSONSource | undefined
    s?.setData((data as any) ?? EMPTY)
  }

  useEffect(() => {
    if (!ready || !props.layers) return
    set('kecamatan', props.layers.kecamatan)
    set('kelurahan', props.layers.kelurahan)
    set('zones', props.layers.zones)
    set('shelters', props.layers.shelters)
    set('sirens', props.layers.sirens)
    const focusing = props.focusRoute && (props.route?.geometry as GeoJSON.LineString | undefined)?.coordinates?.length
    if (!fitted.current && props.layers.bounds && !props.view && !focusing) {
      const [a, b, c, d] = props.layers.bounds
      map.current!.fitBounds(
        [
          [a, b],
          [c, d],
        ],
        { padding: 24, duration: 0 },
      )
      fitted.current = true
    }
  }, [ready, props.layers])

  useEffect(() => {
    if (ready) set('roads', props.roads)
  }, [ready, props.roads])
  useEffect(() => {
    if (ready) set('cells', props.cells)
  }, [ready, props.cells])
  useEffect(() => {
    if (!ready) return
    set('route', props.route ?? null)
    const coords = (props.route?.geometry as GeoJSON.LineString | undefined)?.coordinates
    if (props.focusRoute && coords?.length) {
      fitted.current = true
      const xs = coords.map((c) => c[0])
      const ys = coords.map((c) => c[1])
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      map.current!.fitBounds(
        [
          [Math.min(...xs), Math.min(...ys)],
          [Math.max(...xs), Math.max(...ys)],
        ],
        { padding: { top: 90, bottom: 90, left: 70, right: 70 }, maxZoom: 14.6, duration: reduce ? 0 : 600 },
      )
    }
  }, [ready, props.route])
  useEffect(() => {
    if (!ready) return
    set('hypo', {
      type: 'FeatureCollection',
      features: (props.hypothetical ?? []).map((h) => ({ type: 'Feature', properties: { name: h.name }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })),
    })
  }, [ready, props.hypothetical])
  useEffect(() => {
    if (!ready) return
    map.current!.setFilter('jalan-blokir', ['in', ['get', 'id'], ['literal', props.blocked ?? []]])
  }, [ready, props.blocked])
  useEffect(() => {
    if (!ready) return
    map.current!.setFilter('sel-pilih', ['==', ['id'], props.selectedCell ?? -1])
  }, [ready, props.selectedCell])
  useEffect(() => {
    if (!ready || !props.view) return
    const m = map.current!
    const c = m.getCenter()
    if (Math.abs(c.lng - props.view.center[0]) > 1e-7 || Math.abs(c.lat - props.view.center[1]) > 1e-7 || Math.abs(m.getZoom() - props.view.zoom) > 1e-4) {
      m.jumpTo({ center: props.view.center, zoom: props.view.zoom })
    }
  }, [ready, props.view])
  useEffect(() => {
    if (!ready) return
    const v = props.visible ?? {}
    const vis = (ids: string[], on: boolean | undefined) => ids.forEach((id) => map.current!.setLayoutProperty(id, 'visibility', on === false ? 'none' : 'visible'))
    vis(['jalan'], v.roads)
    vis(['kel-garis'], v.kelurahan)
    vis(['zona-isi', 'zona-garis'], v.zones)
    vis(['sirene'], v.sirens)
    vis(['tes', 'tes-hipotetis'], v.shelters)
    vis(['sel', 'sel-garis', 'sel-pilih'], v.cells)
  }, [ready, props.visible])

  return (
    <div className="map" role="region" aria-label={props.label}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {props.children}
    </div>
  )
}

export function MapLegend({ showClasses = true, children, toggles, showHidden = false }: { showClasses?: boolean; children?: ReactNode; toggles?: ReactNode; showHidden?: boolean }) {
  // Terbuka di layar lebar; di ponsel tertutup agar tidak menutupi peta.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 673px)').matches)
  return (
    <details className="map-overlay map-legend" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="legend-title">Legenda</summary>
      {showClasses && (
        <>
          <div className="caption muted" style={{ marginTop: 8 }}>Kelas sisa waktu</div>
          <ul>
            {(['cukup', 'rawan', 'terlambat', 'terputus'] as Cls[]).map((c) => (
              <li key={c}>
                <span className={`swatch swatch-${c}`} aria-hidden="true" />
                {c === 'cukup' ? 'Cukup' : c === 'rawan' ? 'Rawan' : c === 'terlambat' ? 'Terlambat' : 'Terputus'}
              </li>
            ))}
            {showHidden && (
              <li>
                <span className="swatch swatch-hidden" aria-hidden="true" />
                Disembunyikan (&lt; 10 jiwa)
              </li>
            )}
          </ul>
        </>
      )}
      <ul style={{ marginTop: showClasses ? 10 : 0 }}>
        <li>
          <span className="mark mark-vertikal" aria-hidden="true" /> TES vertikal
        </li>
        <li>
          <span className="mark mark-dataran" aria-hidden="true" /> TES dataran tinggi
        </li>
        <li>
          <span className="mark mark-hipotetis" aria-hidden="true" /> TES hipotetis
        </li>
        <li>
          <span className="mark mark-sirene" aria-hidden="true" /> Sirene
        </li>
        <li>
          <span className="mark mark-zona" aria-hidden="true" /> Zona genangan
        </li>
      </ul>
      {children}
      {toggles && <div className="layer-toggles">{toggles}</div>}
    </details>
  )
}
