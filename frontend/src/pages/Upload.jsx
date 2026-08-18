/**
 * Upload — drag, preview, confirm, import.
 *
 * The preview step is the point. A CSV import that commits on drop gives the
 * operator no chance to notice a shifted column or a wrong file until rows are
 * already in the database. Here the file is parsed in the browser first, the
 * detected header is matched against what the API requires, and the first five
 * rows are shown as they will land. Nothing is sent until Confirm is pressed.
 *
 * Parsing is deliberately simple and local: the preview only needs the header
 * and five rows, so it reads the first slice of the file rather than the whole
 * thing. The server re-parses and re-validates the upload in full regardless —
 * the preview is an operator aid, never a substitute for server validation.
 */

import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useRef, useState } from 'react'
import { UploadCloud, FileText, Check, AlertTriangle, X, RotateCw } from 'lucide-react'

import { api, ApiError } from '../lib/api.js'
import { toast } from '../store/toast.js'
import { formatCount } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'

/** Columns the API requires, mirroring backend paysim.mapper.js. */
const REQUIRED = [
  'step', 'type', 'amount', 'nameOrig', 'oldbalanceOrg',
  'newbalanceOrig', 'nameDest', 'oldbalanceDest', 'newbalanceDest',
]
const OPTIONAL = ['isFraud', 'isFlaggedFraud', 'txn_id']

const MAX_BYTES = 50 * 1024 * 1024
const PREVIEW_ROWS = 5

/** Minimal RFC-4180-aware split: enough for a preview, quoted commas included. */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

async function parsePreview(file) {
  // Only the head of the file is read — a 50MB CSV does not need to be in
  // memory to show five rows.
  const slice = await file.slice(0, 256 * 1024).text()
  const lines = slice.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('The file appears to be empty.')

  const headers = splitCsvLine(lines[0])
  const rows = lines.slice(1, PREVIEW_ROWS + 1).map(splitCsvLine)

  const present = new Set(headers)
  const missing = REQUIRED.filter((h) => !present.has(h))
  const unexpected = headers.filter((h) => !REQUIRED.includes(h) && !OPTIONAL.includes(h))

  return { headers, rows, missing, unexpected, sampledLines: lines.length - 1 }
}

function MappingRow({ column, status }) {
  const config = {
    matched: { color: 'var(--clear)', Icon: Check, label: 'matched' },
    missing: { color: 'var(--critical)', Icon: AlertTriangle, label: 'missing' },
    ignored: { color: 'var(--text-dim)', Icon: X, label: 'ignored' },
  }[status]
  const Icon = config.Icon

  return (
    <div className="flex items-center gap-2 border-b border-hairline py-1.5 last:border-b-0">
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} style={{ color: config.color }} aria-hidden="true" />
      <span className="num min-w-0 flex-1 truncate text-[11.5px] text-text">{column}</span>
      <span className="label-caps" style={{ color: config.color }}>{config.label}</span>
    </div>
  )
}

export default function Upload() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)

  const reset = () => {
    setFile(null)
    setPreview(null)
    setParseError(null)
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const accept = useCallback(async (picked) => {
    setParseError(null)
    setResult(null)

    if (!picked) return
    if (!picked.name.toLowerCase().endsWith('.csv')) {
      setParseError(`"${picked.name}" is not a .csv file.`)
      return
    }
    if (picked.size > MAX_BYTES) {
      setParseError(
        `That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is 50 MB — split it and upload in parts.`,
      )
      return
    }

    setFile(picked)
    try {
      setPreview(await parsePreview(picked))
    } catch (err) {
      setParseError(err.message)
    }
  }, [])

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('file', file)
      return api.post('/transactions/upload', form)
    },
    onSuccess: (data) => {
      setResult(data)
      toast.success(
        `${formatCount(data.inserted)} transactions imported`,
        `${formatCount(data.skipped)} already present, ${formatCount(data.failed)} rejected`,
      )
    },
    onError: (err) => {
      toast.error(
        'Import failed',
        err instanceof ApiError && err.code === 'BAD_REQUEST'
          ? err.message
          : (err?.message ?? 'The API did not respond.'),
      )
    },
  })

  const canConfirm = file && preview && preview.missing.length === 0 && !upload.isPending

  return (
    <>
      <PageHeader
        title="Upload"
        description="Import transactions from CSV. Nothing is written until you confirm the preview."
      />

      <PageBody className="flex flex-col gap-4">
        {/* Drop zone */}
        {!file && (
          <Card
            className="transition-all duration-200"
            style={dragActive ? { borderColor: 'var(--accent)', boxShadow: 'var(--accent-glow)' } : undefined}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false) }}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              accept(e.dataTransfer.files?.[0])
            }}
          >
            <label
              htmlFor="csv"
              className="flex cursor-pointer flex-col items-center justify-center px-6 py-20 text-center"
            >
              <motion.div
                animate={dragActive ? { scale: 1.08, y: -3 } : { scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 26 }}
              >
                <UploadCloud
                  className="h-8 w-8"
                  strokeWidth={1.4}
                  style={{ color: dragActive ? 'var(--accent)' : 'var(--text-dim)' }}
                  aria-hidden="true"
                />
              </motion.div>
              <p className="display mt-4 text-[17px] text-text">
                {dragActive ? 'Drop to preview' : 'Drop a CSV here'}
              </p>
              <p className="mt-1.5 text-[12.5px] text-dim">
                or <span className="text-accent">browse</span> · up to 50 MB
              </p>
              <input
                ref={inputRef}
                id="csv"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => accept(e.target.files?.[0])}
              />
            </label>
          </Card>
        )}

        {parseError && (
          <Card className="flex items-start gap-2.5 p-4" style={{ borderColor: 'var(--critical)' }}>
            <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" strokeWidth={1.8} style={{ color: 'var(--critical)' }} aria-hidden="true" />
            <div className="flex-1">
              <p className="text-[13px] text-critical">{parseError}</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={reset}>
                Choose another file
              </Button>
            </div>
          </Card>
        )}

        {/* Preview + confirm */}
        <AnimatePresence>
          {file && preview && !result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="flex flex-col gap-4"
            >
              <Card>
                <CardHeader>
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={1.6} aria-hidden="true" />
                    <CardTitle className="truncate">{file.name}</CardTitle>
                    <span className="num text-[11px] text-dim">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Change file
                  </Button>
                </CardHeader>

                <div className="grid gap-0 md:grid-cols-[260px_1fr]">
                  {/* Column mapping */}
                  <div className="border-b border-hairline p-4 md:border-b-0 md:border-r">
                    <p className="label-caps mb-2 text-dim">Column mapping</p>
                    {REQUIRED.map((col) => (
                      <MappingRow
                        key={col}
                        column={col}
                        status={preview.headers.includes(col) ? 'matched' : 'missing'}
                      />
                    ))}
                    {preview.unexpected.map((col) => (
                      <MappingRow key={col} column={col} status="ignored" />
                    ))}
                  </div>

                  {/* First rows, as they will land */}
                  <div className="min-w-0 p-4">
                    <p className="label-caps mb-2 text-dim">
                      First {Math.min(PREVIEW_ROWS, preview.rows.length)} rows
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr>
                            {preview.headers.map((h) => (
                              <th
                                key={h}
                                className="label-caps whitespace-nowrap border-b border-hairline px-2 py-1.5 text-left"
                                style={{
                                  color: REQUIRED.includes(h)
                                    ? 'var(--text)'
                                    : 'var(--text-dim)',
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td
                                  key={j}
                                  className="num whitespace-nowrap border-b border-hairline px-2 py-1.5 text-text"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
                  {preview.missing.length > 0 ? (
                    <p className="text-[12px] text-critical">
                      Missing required column{preview.missing.length > 1 ? 's' : ''}:{' '}
                      <span className="num">{preview.missing.join(', ')}</span>. The API would
                      reject this file.
                    </p>
                  ) : (
                    <p className="text-[12px] text-dim">
                      All {REQUIRED.length} required columns present
                      {preview.unexpected.length > 0 &&
                        ` · ${preview.unexpected.length} extra column${preview.unexpected.length > 1 ? 's' : ''} ignored`}
                      .
                    </p>
                  )}

                  <Button
                    variant="primary"
                    disabled={!canConfirm}
                    loading={upload.isPending}
                    onClick={() => upload.mutate()}
                  >
                    {upload.isPending ? 'Importing' : 'Confirm and import'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result report */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Import report</CardTitle>
                  <Button variant="outline" size="sm" onClick={reset}>
                    <RotateCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    Upload another
                  </Button>
                </CardHeader>

                <div className="grid grid-cols-2 sm:grid-cols-4">
                  {[
                    ['Rows read', result.totalRows, 'var(--text)'],
                    ['Inserted', result.inserted, 'var(--clear)'],
                    ['Skipped', result.skipped, 'var(--text-dim)'],
                    ['Rejected', result.failed, result.failed > 0 ? 'var(--critical)' : 'var(--text-dim)'],
                  ].map(([label, value, color]) => (
                    <div key={label} className="border-b border-r border-hairline px-5 py-4 last:border-r-0">
                      <p className="label-caps text-dim">{label}</p>
                      <p className="num mt-1 text-[20px]" style={{ color }}>
                        {formatCount(value)}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="px-5 py-3 text-[11.5px] leading-relaxed text-dim">
                  <span className="text-text">Skipped</span> rows were valid but already present —
                  matched on their transaction id.{' '}
                  <span className="text-text">Rejected</span> rows could not be mapped and are
                  listed below with their line number. A bad row never aborts the import.
                </p>

                {result.errors?.length > 0 && (
                  <div className="border-t border-hairline">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex gap-3 border-b border-hairline px-5 py-2 last:border-b-0">
                        <span className="num w-12 shrink-0 text-[11px] text-dim">line {e.row}</span>
                        <span className="text-[11.5px] text-critical">{e.message}</span>
                      </div>
                    ))}
                    {result.errorsTruncated && (
                      <p className="num px-5 py-2 text-[11px] text-dim">
                        …and {formatCount(result.errorsOmitted)} more
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </PageBody>
    </>
  )
}
