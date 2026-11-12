import { handleCoresignal } from './_coresignal.js'

/** Vercel function: /api/coresignal — licensed people, company and job data (CORESIGNAL_API_KEY). */
export const GET = (request: Request) => handleCoresignal(request)
