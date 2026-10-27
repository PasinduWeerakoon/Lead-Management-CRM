import { handleResearch } from './_research.js'

/** Vercel function: POST /api/research — reads a company's public website and job feeds. */
export const config = { maxDuration: 60 }
export const POST = (request: Request) => handleResearch(request)
