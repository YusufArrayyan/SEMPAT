import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../components/ui'

export default function NotFound() {
  useDocumentTitle('Halaman tidak ditemukan')
  return (
    <div className="page page-narrow">
      <p className="eyebrow muted">Galat 404</p>
      <h1 className="display" style={{ margin: '8px 0 16px' }}>
        Halaman ini tidak ada.
      </h1>
      <p className="body-lg muted" style={{ marginBottom: 24 }}>
        Alamatnya mungkin salah ketik, atau hasil yang dicari sudah dipindahkan.
      </p>
      <Link to="/" className="btn btn-primary">
        Kembali ke dasbor
      </Link>
    </div>
  )
}
