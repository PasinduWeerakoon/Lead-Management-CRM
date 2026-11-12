import { handleAdmin } from './_admin.js'

/** Vercel function: /api/admin — the super admin's view of accounts and searches. */
export const GET = (request: Request) => handleAdmin(request)
export const POST = (request: Request) => handleAdmin(request)
