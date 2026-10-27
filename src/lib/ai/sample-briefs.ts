import type { Brief } from '../schemas'

/**
 * Ready-made scoring briefs, written for what a LinkedIn export actually contains: job title,
 * company, seniority, function, connection year — plus company HQ, location, industry and size
 * when they've been filled in. Edit them freely; "Add sample briefs" brings back any you delete.
 */
export const SAMPLE_BRIEFS: Array<Pick<Brief, 'id' | 'name' | 'text'>> = [
  {
    id: 'sample-founders',
    name: 'Founders & CEOs who may need software',
    text: `Offer: custom software, ERP/CRM (e.g. Microsoft Dynamics 365 Business Central) and digital transformation for small and medium businesses.
Ideal people: Founders, Co-founders, CEOs, Managing Directors, Owners and Presidents who run the company themselves.
Strong signals: founder/CEO/MD title at a small or growing company, especially outside large corporates; companies in trading, manufacturing, logistics, retail, healthcare, education or services that likely still run on spreadsheets.
Weaker fit: founders of software agencies or IT consultancies (they build software themselves), self-employed freelancers, students.
Location: Sri Lanka and nearby markets are preferred when the company HQ or location is known.`,
  },
]

/** The samples as storable briefs (seeded on first run, restorable from the Briefs page). */
export function sampleBriefRecords(now: string): Brief[] {
  return SAMPLE_BRIEFS.map((b, i) => ({
    ...b,
    // Keeps their order when listed newest first.
    createdAt: new Date(new Date(now).getTime() - i).toISOString(),
    updatedAt: new Date(new Date(now).getTime() - i).toISOString(),
  }))
}
