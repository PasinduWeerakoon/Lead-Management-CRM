import { handleStatus } from './_routes'

/** Vercel function: GET /api/status — is the shared database set up, and is the access code right. */
export function GET(request: Request): Response {
  return handleStatus(request)
}
