import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ClassLegendList, Loading, useDocumentTitle } from '../components/ui'
import { api } from '../lib/api'
import type { Meta } from '../lib/types'

export default function Methodology() {
  useDocumentTitle('Metodologi')
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: Infinity })
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Metodologi dan asumsi · mesin hitung {meta.data?.engine_version ?? '…'}</p>
          <h1 className="display">Satu rumus menjadi inti sistem</h1>
          <p className="lead">
            Sisa waktu sama dengan waktu tiba gelombang dikurangi jeda respons dan waktu tempuh ke TES terdekat. Nilai positif berarti warga di sel itu sempat; nilai negatif berarti perlu intervensi.
            Peta, indeks, prioritas, dan uji intervensi hanyalah cara membaca, membandingkan, dan mengubah masukan rumus ini.
          </p>
        </div>
      </div>

      <section className="stack stack-16" aria-labelledby="rumus">
        <h2 id="rumus" className="title">
          Rumus
        </h2>
        <div className="stack" style={{ gap: 1 }}>
          <p className="equation">v = v_moda × f_malam</p>
          <p className="equation">t_i = d_i / (60 · v)</p>
          <p className="equation">m_i = T_a − (τ + t_i)</p>
          <p className="equation">IK_k = Σ_(i∈k) P_i · 1[m_i ≥ 0] / Σ_(i∈k) P_i</p>
          <p className="equation">B_j = Σ_(i→j) P_i / C_j</p>
        </div>
        <div className="kv">
          <div>Sel i</div>
          <div>Kisi 100 m × 100 m berpenduduk P_i, diwakili titik pusatnya.</div>
          <div>d_i</div>
          <div>Jarak terpendek lewat jaringan jalan ke TES terdekat (meter), termasuk jarak kait sel ke simpul jalan terdekat dan TES ke simpul terdekat.</div>
          <div>v</div>
          <div>Kecepatan efektif (m/detik).</div>
          <div>τ</div>
          <div>Jeda respons: waktu sebelum warga mulai bergerak (menit).</div>
          <div>T_a</div>
          <div>Waktu tiba gelombang (menit).</div>
          <div>b</div>
          <div>Margin pengaman (menit): batas antara Cukup dan Rawan.</div>
          <div>IK_k</div>
          <div>Indeks kecukupan wilayah k: porsi penduduk sel terdampak dengan sisa waktu tidak negatif.</div>
          <div>B_j</div>
          <div>Beban TES j: penduduk yang ditugaskan dibagi kapasitas C_j.</div>
        </div>
        <p className="muted">
          Penugasan memakai TES terdekat lewat jaringan, dihitung dengan satu pencarian Dijkstra multi-sumber dari semua TES sah; ini bukan pembagian beban optimal. Jarak hanya bergantung pada
          jaringan jalan dan lokasi TES, sehingga dihitung sekali per skenario dan dipakai ulang pada Matriks 12 dan Monte Carlo.
        </p>
      </section>

      <section className="section stack stack-16" aria-labelledby="kelas">
        <h2 id="kelas" className="title">
          Kelas sisa waktu
        </h2>
        <div className="map-legend" style={{ position: 'static', border: '1px solid var(--hairline)', padding: 16, maxWidth: 'none' }}>
          <ClassLegendList
            counts={{ cukup: 'm ≥ b — sempat dengan cadangan waktu', rawan: '0 ≤ m < b — sempat, tidak tahan galat parameter', terlambat: 'm < 0 — tidak sempat; masuk daftar intervensi', terputus: 'tidak ada jalur ke TES; perbaikan data' }}
          />
        </div>
        <p className="muted">Keempat warna dapat dibedakan penderita buta warna dan selalu disertai pola isi serta label teks, sehingga makna tidak bergantung pada warna.</p>
      </section>

      <section className="section stack stack-16" aria-labelledby="param">
        <h2 id="param" className="title">
          Parameter dan sumbernya
        </h2>
        <p className="muted">Semua nilai berikut adalah masukan, bukan hasil temuan. Pengguna dapat menggantinya; setiap perubahan tercatat pada skenario.</p>
        {meta.isLoading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Nilai awal</th>
                  <th>Sumber</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {meta.data?.parameter_sources.map((p) => (
                  <tr key={p.key}>
                    <td>
                      {p.label} <span className="mono muted">{p.symbol}</span>
                    </td>
                    <td className="nowrap">{p.value}</td>
                    <td style={{ minWidth: 240 }}>{p.source}</td>
                    <td>
                      <span className={`tag ${p.status.startsWith('perlu') ? 'tag-yellow' : 'tag-outline'}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Uji sensitivitas Monte Carlo menjalankan N = 1.000 undian dari sebaran segitiga (minimum, modus, maksimum) atas τ, T_a, dan v, lalu melaporkan median serta persentil ke-5 hingga ke-95
          IK per wilayah. Benih acak dicatat agar hasil dapat diulang.
        </p>
      </section>

      <section className="section stack stack-16" aria-labelledby="prio">
        <h2 id="prio" className="title">
          Aturan daftar prioritas
        </h2>
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Aturan</th>
                <th>Syarat pada skenario dasar</th>
                <th>Rekomendasi</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>Ada penduduk Terlambat walau τ = 0</td>
                <td>Kategori utama: tambah atau pindahkan TES</td>
              </tr>
              <tr>
                <td>2</td>
                <td>Penduduk Terlambat hanya muncul pada τ &gt; 0</td>
                <td>Kategori utama: percepat respons (sirene, latihan, rambu)</td>
              </tr>
              <tr>
                <td>3</td>
                <td>Rasio jarak jaringan terhadap garis lurus &gt; 1,5 pada sel Terlambat</td>
                <td>Penanda: perbaiki atau tambah rute</td>
              </tr>
              <tr>
                <td>4</td>
                <td>Penduduk Terlambat bertambah saat f_malam diterapkan</td>
                <td>Penanda: penerangan jalur evakuasi</td>
              </tr>
              <tr>
                <td>5</td>
                <td>B_j &gt; 1 pada TES yang melayani kelurahan</td>
                <td>Penanda: perluas kapasitas atau pecah beban</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Aturan 1 dan 2 saling meniadakan; setiap kelurahan dengan penduduk Terlambat menerima tepat satu kategori utama dan nol sampai tiga penanda. Kelurahan diurutkan menurut jumlah penduduk
          Terlambat, lalu rerata defisit menit. Ambang 1,5 pada aturan 3 dapat diubah di editor skenario.
        </p>
      </section>

      <section className="section stack stack-16" aria-labelledby="batas">
        <h2 id="batas" className="title">
          Keterbatasan versi 1.0
        </h2>
        <ul className="list-plain list-rows">
          <li>Arah jalan satu arah diabaikan; semua ruas dianggap dua arah.</li>
          <li>Kemiringan dan kondisi permukaan jalan tidak dimodelkan; pengaruhnya hanya lewat faktor malam dan margin pengaman.</li>
          <li>Satu sel diwakili satu titik; penduduk di dalam sel dianggap seragam. Tanpa poligon permukiman, penduduk kelurahan dibagi merata ke selnya.</li>
          <li>Penugasan ke TES terdekat tidak mempertimbangkan kapasitas; beban dilaporkan terpisah sebagai B_j.</li>
          <li>Kendaraan tidak saling menghambat; kecepatan kendaraan adalah rerata efektif, bukan hasil simulasi lalu lintas.</li>
          <li>Hanya sel permukiman di dalam zona genangan yang dihitung; IK memakai penduduk terdampak sebagai penyebut.</li>
          <li>Sel yang berjarak lebih dari 200 m dari jalan ditandai Terputus. Jaringan tanpa gang dan jalan setapak membuat jarak jalan kaki terlalu panjang (hasil konservatif).</li>
          <li>Kecepatan, jeda, dan faktor malam belum berbasis lapangan; kalibrasi dilakukan pada fase uji lapangan bersama BPBD.</li>
        </ul>
      </section>

      <section className="section stack stack-16" aria-labelledby="bukan">
        <h2 id="bukan" className="title">
          Yang bukan tujuan sistem ini
        </h2>
        <p>
          Sempat bukan sistem peringatan dini, bukan prediktor tsunami, tidak memberi arahan rute langkah demi langkah kepada warga, dan tidak menggantikan kajian teknis BPBD. Simulasi perilaku
          massa dan model pembelajaran mesin tidak termasuk.
        </p>
        <p className="muted">
          Rujukan: Ar dkk. (2025); Triatmadja &amp; Nasution (2014); Fachri (2022); Mayasari dkk. (2026); Susetyo (2023). Data contoh yang terpasang adalah data sintetis; lihat{' '}
          <Link to="/data">halaman Data</Link> untuk sumber dan lisensi setiap dataset.
        </p>
      </section>
    </div>
  )
}
