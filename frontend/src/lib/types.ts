export type Role = 'admin' | 'analis' | 'peneliti'
export type Cls = 'cukup' | 'rawan' | 'terlambat' | 'terputus'
export type RunStatus = 'antrean' | 'berjalan' | 'selesai' | 'gagal' | 'dibatalkan'
export type RunKind = 'tunggal' | 'matriks' | 'monte_carlo'
export type Mode = 'jalan_kaki' | 'kendaraan'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
  created_at: string
}

export interface Issue {
  check: string
  message: string
  hint: string
}

export interface FileInfo {
  name: string
  size: number
  rows_ok: number
  rows_rejected: number
  rejected: { row: number | string; reason: string }[]
  warnings: string[]
  crs: string
  uploaded_at: string
}

export interface Dataset {
  id: string
  name: string
  version: number
  status: 'draf' | 'tervalidasi' | 'terbit' | 'arsip'
  checksum: string | null
  source: string
  license: string
  license_open: boolean
  accessed_at: string
  notes: string
  files: Record<string, FileInfo>
  stats: Record<string, number> | null
  parent_id: string | null
  created_at: string
  published_at: string | null
  has_errors: boolean
  warning_count: number
  validation?: {
    generated_at: string
    crs: Record<string, string>
    errors: Issue[]
    warnings: Issue[]
    population_issues: { code: string; name: string; issue: string }[]
    shelters: { id: string; name: string; type: string; flag: string; note: string; in_zone: boolean }[]
    road: { nodes: number; edges: number; components: number; largest_component_share: number }
    grid: Record<string, number>
    counts: Record<string, number>
  } | null
}

export interface Params {
  delay_min: number
  arrival_min: number
  mode: Mode
  speed_ms: number
  night: boolean
  night_factor: number
  buffer_min: number
  detour_threshold: number
}

export interface Intervention {
  id: string
  type: 'tambah_tes' | 'blokir_ruas' | 'kurangi_jeda'
  label: string
  payload: Record<string, any>
  enabled: boolean
  created_at: string
}

export interface MonteCarlo {
  n: number
  seed: number | null
  delay: number[]
  arrival: number[]
  speed: number[]
}

export interface Summary {
  ik: number | null
  pop_total: number
  pop_cukup: number
  pop_rawan: number
  pop_late: number
  pop_terputus: number
  mean_deficit: number
  cells: number
  cell_counts: Record<Cls, number>
  shelters: number
  shelters_overloaded: number
  shelters_unknown_capacity: number
  blocked_segments: string[]
  effective_delay_min: number
  velocity_ms: number
  mc: { ik_p5: number; ik_p50: number; ik_p95: number } | null
}

export interface Run {
  id: string
  scenario_id: string
  dataset_id: string
  kind: RunKind
  label: string
  with_interventions: boolean
  base_run_id: string | null
  status: RunStatus
  progress: number
  stage: string
  input_hash: string
  engine_version: string
  seed: number | null
  params: Params
  mc: MonteCarlo | null
  interventions: { id: string; type: string; label: string; payload: Record<string, any> }[]
  shelters_extra: { id: string; name: string; lon: number; lat: number; capacity: number | null }[]
  summary: Summary | null
  error: { message: string; hint: string } | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  duration_s: number | null
  scenario_name?: string
  dataset?: Dataset
  share_token?: string | null
}

export interface Scenario extends Params {
  id: string
  dataset_id: string
  name: string
  description: string
  preset: string | null
  monte_carlo: MonteCarlo
  archived: boolean
  history: { at: string; by: string; change: string; values?: any }[]
  created_by: string | null
  created_at: string
  updated_at: string
  last_run: Run | null
  last_completed_run?: Run | null
  interventions?: Intervention[]
  dataset?: Dataset
}

export interface AreaRow {
  area_code: string
  name: string
  parent: string | null
  level: 'kecamatan' | 'kelurahan' | 'kota'
  population_all: number | null
  data_year: number | null
  ik: number | null
  pop_total: number
  pop_cukup: number
  pop_rawan: number
  pop_late: number
  pop_terputus: number
  mean_deficit: number
  ik_p5: number | null
  ik_p50: number | null
  ik_p95: number | null
}

export interface ShelterRow {
  shelter_id: string
  name: string
  type: string
  hypothetical: boolean
  assigned_pop: number
  capacity: number | null
  load: number | null
  flag: string
  lon: number | null
  lat: number | null
}

export interface PriorityRow {
  rank: number
  area_code: string
  name: string
  kecamatan: string | null
  category: 'tambah_tes' | 'percepat_respons'
  flags: string[]
  pop_late: number
  mean_deficit: number
  rationale: { rule: number; text: string; value: string }[]
}

export interface CellDetail {
  cell_id: number
  kelurahan: string
  kecamatan: string | null
  population: number | null
  lon: number
  lat: number
  cls: Cls
  dist_m: number | null
  euclid_m: number | null
  snap_m: number | null
  time_min: number | null
  margin_min: number | null
  params: { delay_min: number; arrival_min: number; mode: Mode; velocity_ms: number; buffer_min: number }
  shelter: { id: string; name: string; type: string; capacity: number | null; hypothetical: boolean; lon: number; lat: number } | null
  route: GeoJSON.Feature<GeoJSON.LineString> | null
}

export interface Layers {
  kecamatan: GeoJSON.FeatureCollection
  kelurahan: GeoJSON.FeatureCollection
  zones: GeoJSON.FeatureCollection
  shelters: GeoJSON.FeatureCollection
  sirens: GeoJSON.FeatureCollection
  bounds: [number, number, number, number] | null
}

export interface Meta {
  engine_version: string
  presets: Record<string, Params & { label: string; description: string }>
  monte_carlo_default: { n: number; delay: number[]; arrival: number[]; speed: Record<Mode, number[]> }
  parameter_sources: { key: string; symbol: string; label: string; value: string; source: string; status: string }[]
  matrix: { delays: number[]; arrivals: number[]; modes: Mode[] }
  default_speeds: Record<Mode, number>
  file_kinds: Record<string, string>
  allowed_ext: Record<string, string[]>
}
