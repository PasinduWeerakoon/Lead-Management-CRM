import { handleAuth } from './_auth.js'

/** Vercel function: /api/auth — who is signed in, sign up, sign in and sign out. */
export const GET = (request: Request) => handleAuth(request)
export const POST = (request: Request) => handleAuth(request)
export const DELETE = (request: Request) => handleAuth(request)
