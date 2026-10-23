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
  {
    id: 'sample-bfsi',
    name: 'Inside champions at banks & insurers',
    text: `Offer: Microsoft Dynamics 365, Power Platform and process automation for banks, insurers and finance companies — customer onboarding, claims, loan workflows, reporting and Power BI dashboards. Goal: a warm introduction to the people who decide on technology.
Ideal people: anyone at a bank, insurance, assurance, life, leasing or finance company who can champion the idea or introduce us — Managers and above in IT, digital, operations, finance or transformation (best), and technology staff at any level (software engineers, business analysts, data/BI people, QA) who work with the decision-makers.
Strong signals: company names with Bank, Insurance, Assurance, Life, Finance, Leasing or Capital; titles mentioning IT, digital, systems, applications, data, analyst, automation, operations or transformation; Manager level scores higher than individual contributors.
Weaker fit: branch, sales, relationship, marketing or customer-service roles with no link to technology or operations; interns.
Location: Sri Lanka first (e.g. Colombo), then the wider region.`,
  },
  {
    id: 'sample-eng-leaders',
    name: 'Engineering leaders who hire teams',
    text: `Offer: dedicated software engineering and QA teams (staff augmentation / offshore delivery) from Sri Lanka.
Ideal people: CTOs, VPs of Engineering, Heads of Engineering/Technology, Engineering Managers, Delivery Managers and Directors of QA at product companies and IT services firms that grow their teams.
Strong signals: engineering/technology leadership titles; companies building software products or delivering IT projects (SaaS, fintech, healthtech, e-commerce); companies headquartered in the US, UK, Europe or Australia with engineering in Sri Lanka.
Weaker fit: individual engineers without hiring responsibility (Software Engineer, QA Engineer, Developer), students and interns, recruiters.
Location: any; companies headquartered abroad are a plus.`,
  },
  {
    id: 'sample-people-ops',
    name: 'HR & resource managers at IT firms',
    text: `Offer: a resource planning tool for IT services companies — who is allocated to which project, utilisation, bench, and billing reports.
Ideal people: Heads of HR/People, HR Managers, Resource Managers, Workforce/Capacity Planners, Delivery and Project Management Office (PMO) leads, COOs and Operations Managers at software and IT services companies.
Strong signals: HR, people, talent, resource, workforce, PMO, delivery or operations titles at technology companies with many engineers; Manager level and above.
Weaker fit: recruiters at recruitment agencies, HR executives/assistants, HR roles outside technology companies.
Location: Sri Lanka and South Asia preferred when known.`,
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
