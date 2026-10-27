import { handleAi } from './_ai.js'

/** Vercel function: /api/ai — company OpenAI key on the server, with a daily spending limit. */
export const config = { maxDuration: 60 }
export const GET = (request: Request) => handleAi(request)
export const POST = (request: Request) => handleAi(request)
