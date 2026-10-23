import { handleProfiles } from './_routes'

/** Vercel function: /api/profiles — list, create, rename and delete profiles. */
export const GET = (request: Request) => handleProfiles(request)
export const POST = (request: Request) => handleProfiles(request)
export const PATCH = (request: Request) => handleProfiles(request)
export const DELETE = (request: Request) => handleProfiles(request)
