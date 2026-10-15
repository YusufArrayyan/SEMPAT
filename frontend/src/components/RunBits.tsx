import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api'
import { STATUS_LABEL, STATUS_TAG } from '../lib/format'
import type { Run, RunStatus } from '../lib/types'
import { ErrorNotice, Icon, Notice, ProgressBar } from './ui'

export function RunStatusTag({ status }: { status: RunStatus }) {
  return (
    <span className={`tag ${STATUS_TAG[status]}`}>
      {status === 'berjalan' && <span className="dot" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  )
}

export const isFinal = (s?: RunStatus) => s === 'selesai' || s === 'gagal' || s === 'dibatalkan'

/** Status run; diperiksa tiap 2 detik sampai final (PRD 7.3). */
export function useRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => api.get<Run>(`/runs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isFinal(q.state.data?.status) ? false : 2000),
  })
}

export function RunProgress({ run, onDone }: { run: Run; onDone?: (r: Run) => void }) {
  const qc = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => api.del<Run>(`/runs/${run.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', run.id] }),
  })
  useEffect(() => {
    if (run.status === 'selesai') onDone?.(run)
  }, [run.status])

  if (run.status === 'gagal')
    return (
      <Notice kind="error" title={run.error?.message ?? 'Perhitungan gagal.'}>
        {run.error?.hint}
      </Notice>
    )
  if (run.status === 'dibatalkan') return <Notice kind="warning" title="Perhitungan dibatalkan." />
  if (run.status === 'selesai') return null
  return (
    <div className="tile-flat stack stack-8" aria-live="polite">
      <div className="row between">
        <span className="heading-sm">{run.status === 'antrean' ? 'Dalam antrean…' : run.stage || 'Menghitung…'}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          Batalkan <Icon name="stop" />
        </button>
      </div>
      <ProgressBar value={run.progress} label="Kemajuan perhitungan" />
      {cancel.error && <ErrorNotice error={cancel.error} />}
    </div>
  )
}
