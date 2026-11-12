import { handleClaims } from './_claims.js'

/** Vercel function: /api/claims — who collects web data for which connections. */
export const GET = (request: Request) => handleClaims(request)
export const POST = (request: Request) => handleClaims(request)
export const DELETE = (request: Request) => handleClaims(request)
