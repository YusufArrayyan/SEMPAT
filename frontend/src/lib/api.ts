export class ApiError extends Error {
  code: string
  hint: string
  status: number
  constructor(status: number, code: string, message: string, hint = '') {
    super(message)
    this.status = status
    this.code = code
    this.hint = hint
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  const init: RequestInit = { method, credentials: 'include', headers: {} }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'jaringan', 'Server tidak dapat dihubungi.', 'Periksa koneksi internet, lalu coba lagi.')
  }
  if (!res.ok) {
    let err = { code: 'galat', message: `Permintaan gagal (${res.status}).`, hint: 'Coba lagi beberapa saat lagi.' }
    try {
      const j = await res.json()
      if (j?.error) err = j.error
    } catch {
      /* respons bukan JSON */
    }
    throw new ApiError(res.status, err.code, err.message, err.hint)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, f: FormData) => request<T>('POST', p, f),
}
