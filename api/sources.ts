import { handleSources } from './_sources.js'

/** Vercel function: /api/sources — free extra sources (SEC EDGAR, Wikidata, Adzuna, Hunter). */
export const GET = (request: Request) => handleSources(request)
