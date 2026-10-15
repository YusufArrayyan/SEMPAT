import type { Cls, Mode, RunKind, RunStatus } from './types'

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pf = new Intl.NumberFormat('id-ID', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dtf = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
const df = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' })

export const int = (v: number | null | undefined) => (v == null ? '—' : nf0.format(v))
export const dec1 = (v: number | null | undefined) => (v == null ? '—' : nf1.format(v))
export const dec2 = (v: number | null | undefined) => (v == null ? '—' : nf2.format(v))
export const pct = (v: number | null | undefined) => (v == null ? '—' : pf.format(v))
export const dateTime = (v: string | null | undefined) => (v ? `${dtf.format(new Date(v))} WIB` : '—')
export const date = (v: string | null | undefined) => (v ? df.format(new Date(v)) : '—')
export const signedPct = (v: number | null | undefined) => {
  if (v == null) return '—'
  const s = new Intl.NumberFormat('id-ID', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
  return s.format(v)
}
export const signedInt = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(v)
export const minutes = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)} mnt`)
export const bytes = (n: number) => (n > 1048576 ? `${nf1.format(n / 1048576)} MB` : `${nf0.format(Math.ceil(n / 1024))} KB`)

export const CLS_LABEL: Record<Cls, string> = { cukup: 'Cukup', rawan: 'Rawan', terlambat: 'Terlambat', terputus: 'Terputus' }
export const CLS_DESC: Record<Cls, string> = {
  cukup: 'Sempat, dengan cadangan waktu ≥ margin pengaman',
  rawan: 'Sempat, tetapi tidak tahan galat parameter',
  terlambat: 'Tidak sempat; masuk daftar intervensi',
  terputus: 'Tidak ada jalur jalan ke TES; perbaiki data',
}
export const CLS_ORDER: Cls[] = ['cukup', 'rawan', 'terlambat', 'terputus']
export const CLS_COLOR: Record<Cls, string> = { cukup: '#009e73', rawan: '#f0e442', terlambat: '#882255', terputus: '#8c8c8c' }

export const MODE_LABEL: Record<Mode, string> = { jalan_kaki: 'Jalan kaki', kendaraan: 'Kendaraan' }
export const KIND_LABEL: Record<RunKind, string> = { tunggal: 'Tunggal', matriks: 'Matriks 12', monte_carlo: 'Monte Carlo' }
export const STATUS_LABEL: Record<RunStatus, string> = { antrean: 'Antrean', berjalan: 'Berjalan', selesai: 'Selesai', gagal: 'Gagal', dibatalkan: 'Dibatalkan' }
export const STATUS_TAG: Record<RunStatus, string> = { antrean: 'tag-outline', berjalan: 'tag-blue', selesai: 'tag-green', gagal: 'tag-red', dibatalkan: '' }
export const DS_STATUS: Record<string, [string, string]> = {
  draf: ['Draf', 'tag-outline'],
  tervalidasi: ['Tervalidasi', 'tag-blue'],
  terbit: ['Terbit', 'tag-green'],
  arsip: ['Arsip', ''],
}
export const CATEGORY_LABEL: Record<string, string> = {
  tambah_tes: 'Tambah atau pindahkan TES',
  percepat_respons: 'Percepat respons',
}
export const CATEGORY_DESC: Record<string, string> = {
  tambah_tes: 'Ada penduduk Terlambat walaupun jeda respons 0 menit: jarak ke TES terlalu jauh.',
  percepat_respons: 'Penduduk Terlambat hanya muncul karena jeda respons: sirene, latihan, dan rambu dapat menutup selisih.',
}
export const FLAG_LABEL: Record<string, string> = {
  perbaiki_rute: 'Perbaiki atau tambah rute',
  penerangan: 'Penerangan jalur evakuasi',
  perluas_kapasitas: 'Perluas kapasitas atau pecah beban',
}
export const TYPE_LABEL: Record<string, string> = { vertikal: 'Vertikal', dataran_tinggi: 'Dataran tinggi', tak_diketahui: 'Tak diketahui' }

export function paramLine(p: { delay_min: number; arrival_min: number; mode: Mode; night?: boolean }) {
  return `τ ${dec1(p.delay_min)} mnt · Tₐ ${dec1(p.arrival_min)} mnt · ${MODE_LABEL[p.mode]}${p.night ? ' · malam' : ''}`
}
