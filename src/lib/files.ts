import { MAX_FILE_BYTES, type ParsedTable } from './csv'

/** Parses a CSV off the main thread so big exports don't freeze the UI. */
export async function parseCsvFile(file: File | Blob): Promise<ParsedTable> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`)
  }
  const text = await file.text()
  const worker = new Worker(new URL('./csv.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<ParsedTable>((resolve, reject) => {
      worker.onmessage = (e) => (e.data.ok ? resolve(e.data.table) : reject(new Error(e.data.error)))
      worker.onerror = () => reject(new Error('Could not read this file.'))
      worker.postMessage({ text })
    })
  } finally {
    worker.terminate()
  }
}

export function downloadFile(content: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
