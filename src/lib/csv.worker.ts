import { parseCsvText } from './csv'

self.onmessage = (e: MessageEvent<{ text: string }>) => {
  try {
    self.postMessage({ ok: true, table: parseCsvText(e.data.text) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : 'Could not read this file.' })
  }
}
