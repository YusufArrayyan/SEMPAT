import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RunStatusTag } from '../components/RunBits'
import { Empty, ErrorNotice, Icon, IkMeter, Loading, Notice, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { DS_STATUS, KIND_LABEL, dateTime, int, paramLine, pct } from '../lib/format'
import type { Dataset, Issue, Run, Scenario } from '../lib/types'

interface Dash {
  published_dataset: Dataset | null
  datasets: Dataset[]
  scenarios: Scenario[]
  runs: (Run & { scenario_name: string })[]
  data_warnings: Issue[]
  onboarding: { dataset_ready: boolean; scenario_created: boolean; run_done: boolean; report_made: boolean }
}

export default function Dashboard() {
  useDocumentTitle('Dasbor')
  const { user } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/dashboard'), refetchInterval: 10_000 })

  if (q.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    )
  if (q.error)
    return (
      <div className="page">
        <ErrorNotice error={q.error} onRetry={() => q.refetch()} />
      </div>
    )
  const d = q.data!
  const ob = d.onboarding
  const allDone = ob.dataset_ready && ob.scenario_created && ob.run_done && ob.report_made
  const latestDone = d.runs.find((r) => r.status === 'selesai' && r.kind !== 'matriks')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Selamat datang, {user?.name}</p>
          <h1 className="headline">Dasbor</h1>
        </div>
        <div className="btn-row">
          <Link to="/skenario?baru=1" className="btn btn-primary">
            Buat skenario <Icon name="add" />
          </Link>
        </div>
      </div>

      <div className="grid-4">
        <div className="stat">
          <div className="k">Dataset terbit</div>
          <div className="v" style={{ fontSize: 20, marginTop: 8 }}>
            {d.published_dataset ? `v${d.published_dataset.version}` : 'Belum ada'}
          </div>
          <div className="d truncate">{d.published_dataset?.name ?? 'Impor data di halaman Data'}</div>
        </div>
        <div className="stat">
          <div className="k">IK kota, hasil terakhir</div>
          <div className="v">{latestDone?.summary ? pct(latestDone.summary.ik) : '—'}</div>
          <div className="d">{latestDone ? paramLine(latestDone.params) : 'Belum ada hasil'}</div>
        </div>
        <div className="stat">
          <div className="k">Penduduk Terlambat</div>
          <div className="v">{latestDone?.summary ? int(latestDone.summary.pop_late) : '—'}</div>
          <div className="d">jiwa di zona genangan, skenario yang sama</div>
        </div>
        <div className="stat">
          <div className="k">Peringatan kualitas data</div>
          <div className="v">{d.data_warnings.length}</div>
          <div className="d">pada dataset terbit</div>
        </div>
      </div>

      {!allDone && (
        <section className="section" aria-labelledby="ob-title">
          <div className="section-head">
            <h2 id="ob-title" className="subhead">
              Panduan alur pertama
            </h2>
            <span className="caption muted">Empat langkah dari data sampai laporan</span>
          </div>
          <ol className="steps">
            <li data-done={ob.dataset_ready}>
              <div className="step-title heading-sm">Siapkan dataset terbit</div>
              <p className="muted">Impor TES, jalan, batas wilayah, penduduk, dan zona genangan; validasi; lalu terbitkan. Data contoh sintetis sudah terbit.</p>
              {!ob.dataset_ready && <Link to="/data">Buka halaman Data</Link>}
            </li>
            <li data-done={ob.scenario_created}>
              <div className="step-title heading-sm">Buat skenario</div>
              <p className="muted">Pilih preset “Esai 2026” atau “Fachri 2022”, lalu ubah jeda respons, waktu tiba, dan moda sesuai kajian.</p>
              {!ob.scenario_created && <Link to="/skenario?baru=1">Buat skenario</Link>}
            </li>
            <li data-done={ob.run_done}>
              <div className="step-title heading-sm">Jalankan dan baca peta</div>
              <p className="muted">Klik sel di peta untuk melihat rute ke TES terdekat dan rincian waktunya. Tabel di panel kanan memuat angka yang sama.</p>
            </li>
            <li data-done={ob.report_made}>
              <div className="step-title heading-sm">Ekspor laporan</div>
              <p className="muted">Unduh PDF 2–4 halaman yang memuat parameter, versi data, dan batasan; atau CSV dan GeoJSON.</p>
            </li>
          </ol>
        </section>
      )}

      <div className="grid-2 section" style={{ gap: 32 }}>
        <section aria-labelledby="sc-title">
          <div className="section-head">
            <h2 id="sc-title" className="subhead">
              Skenario terakhir
            </h2>
            <Link to="/skenario">Semua skenario</Link>
          </div>
          {d.scenarios.length === 0 ? (
            <Empty title="Belum ada skenario" action={<Link to="/skenario?baru=1">Buat skenario pertama</Link>}>
              Skenario menyimpan parameter jeda, waktu tiba, moda, dan intervensi.
            </Empty>
          ) : (
            <ul className="list-plain list-rows">
              {d.scenarios.map((s) => (
                <li key={s.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/skenario/${s.id}`} className="truncate" style={{ display: 'block' }}>
                      {s.name}
                    </Link>
                    <span className="caption muted">{paramLine(s)}</span>
                  </div>
                  {s.last_run && <RunStatusTag status={s.last_run.status} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="run-title">
          <div className="section-head">
            <h2 id="run-title" className="subhead">
              Perhitungan terbaru
            </h2>
          </div>
          {d.runs.length === 0 ? (
            <Empty title="Belum ada perhitungan">Jalankan skenario dari editor skenario.</Empty>
          ) : (
            <ul className="list-plain list-rows">
              {d.runs.map((r) => (
                <li key={r.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/hasil/${r.id}`} className="truncate" style={{ display: 'block' }}>
                      {r.scenario_name} · {r.label || KIND_LABEL[r.kind]}
                    </Link>
                    <span className="caption muted">
                      {dateTime(r.created_at)}
                      {r.summary && r.kind !== 'matriks' && ` · IK ${pct(r.summary.ik)}`}
                    </span>
                  </div>
                  <div className="row" style={{ flexShrink: 0 }}>
                    {r.summary && r.kind !== 'matriks' && (
                      <div style={{ width: 72 }}>
                        <IkMeter value={r.summary.ik} />
                      </div>
                    )}
                    <RunStatusTag status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section" aria-labelledby="dq-title">
        <div className="section-head">
          <h2 id="dq-title" className="subhead">
            Status data
          </h2>
          <Link to="/data">Kelola data</Link>
        </div>
        {d.data_warnings.length > 0 ? (
          <Notice kind="warning" title={`${d.data_warnings.length} peringatan kualitas data pada dataset terbit`}>
            <ul>
              {d.data_warnings.map((w, i) => (
                <li key={i}>
                  {w.message} <span className="muted">{w.hint}</span>
                </li>
              ))}
            </ul>
          </Notice>
        ) : (
          <Notice kind="success" title="Tidak ada peringatan kualitas data." />
        )}
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="dt compact">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Versi</th>
                <th>Status</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {d.datasets.map((ds) => (
                <tr key={ds.id}>
                  <td>
                    <Link to={`/data/${ds.id}`}>{ds.name}</Link>
                  </td>
                  <td className="num">v{ds.version}</td>
                  <td>
                    <span className={`tag ${DS_STATUS[ds.status][1]}`}>{DS_STATUS[ds.status][0]}</span>
                  </td>
                  <td>{dateTime(ds.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
