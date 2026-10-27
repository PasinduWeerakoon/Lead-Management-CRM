import { handleData } from './_routes.js'

/** Vercel function: /api/data — read changes since a point (GET) and save changes (POST) for a profile. */
export const GET = (request: Request) => handleData(request)
export const POST = (request: Request) => handleData(request)
