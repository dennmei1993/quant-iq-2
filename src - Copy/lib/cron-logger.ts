// src/lib/cron-logger.ts
// Lightweight wrapper for logging cron job runs to cron_logs table.
// Usage — wrap any cron route handler:
//
//   import { cronLog } from '@/lib/cron-logger'
//
//   export async function GET(req: Request) {
//     const log = await cronLog.start('themes', 'analysis')
//     try {
//       const count = await runThemesJob()
//       await log.success({ records_out: count })
//       return Response.json({ ok: true })
//     } catch (err) {
//       await log.fail(err)
//       return Response.json({ ok: false }, { status: 500 })
//     }
//   }

import { createServiceClient } from '@/lib/supabase/server'

export type JobGroup    = 'prices' | 'intelligence' | 'analysis' | 'maintenance'
export type JobStatus   = 'running' | 'success' | 'failed' | 'skipped'
export type TriggeredBy = 'schedule' | 'manual' | 'webhook'

export interface LogOptions {
  records_in?:  number
  records_out?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?:        Record<string, any>
}

export interface CronHandle {
  id:      string
  success: (opts?: LogOptions) => Promise<void>
  skip:    (reason?: string) => Promise<void>
  fail:    (err: unknown, opts?: LogOptions) => Promise<void>
}

function triggeredBy(req?: Request): TriggeredBy {
  if (!req) return 'schedule'
  const h = req.headers.get('x-triggered-by')
  if (h === 'manual' || h === 'webhook') return h
  // Vercel cron sends this header
  const cronHeader = req.headers.get('x-vercel-cron')
  return cronHeader ? 'schedule' : 'manual'
}

async function start(
  jobName:  string,
  jobGroup: JobGroup,
  req?:     Request,
): Promise<CronHandle> {
  const db = createServiceClient()

  const { data, error } = await db
    .from('cron_logs')
    .insert({
      job_name:     jobName,
      job_group:    jobGroup,
      status:       'running',
      triggered_by: triggeredBy(req),
    })
    .select('id')
    .single()

  // If insert fails (e.g. table doesn't exist yet), return a no-op handle
  // so the cron job itself still runs
  const id = (data as any)?.id ?? 'noop'
  if (error) {
    console.warn('[cron-logger] Failed to create log entry:', error.message)
  }

  async function finish(
    status:  JobStatus,
    opts:    LogOptions = {},
    errMsg?: string,
    errDet?: string,
  ) {
    if (id === 'noop') return
    await db
      .from('cron_logs')
      .update({
        status,
        finished_at:   new Date().toISOString(),
        records_in:    opts.records_in  ?? null,
        records_out:   opts.records_out ?? null,
        meta:          (opts.meta ?? null) as any,
        error_message: errMsg           ?? null,
        error_detail:  errDet           ?? null,
      })
      .eq('id', id)
  }

  return {
    id,

    async success(opts?: LogOptions) {
      await finish('success', opts)
    },

    async skip(reason?: string) {
      await finish('skipped', {}, reason)
    },

    async fail(err: unknown, opts?: LogOptions) {
      const message = err instanceof Error ? err.message : String(err)
      const detail  = err instanceof Error && err.stack ? err.stack : undefined
      await finish('failed', opts ?? {}, message, detail)
    },
  }
}

export const cronLog = { start }
