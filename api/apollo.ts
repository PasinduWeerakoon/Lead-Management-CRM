import { handleApollo } from './_apollo'

/** Vercel function: POST /api/apollo — forwards allowed Apollo calls with the caller's own key. */
export function POST(request: Request): Promise<Response> {
  return handleApollo(request)
}
