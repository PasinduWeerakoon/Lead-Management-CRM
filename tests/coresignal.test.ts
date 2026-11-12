import { describe, expect, it } from 'vitest'
import { ContactSchema } from '../src/lib/schemas'
import { linkedinShorthand, mapCompany, mapPerson } from '../api/_coresignal'

const at = '2026-11-12T00:00:00.000Z'

describe('Coresignal mapping', () => {
  it('reads the profile name from a LinkedIn URL', () => {
    expect(linkedinShorthand('https://www.linkedin.com/in/ana-example/', 'in')).toBe('ana-example')
    expect(linkedinShorthand('https://www.linkedin.com/company/example-co?x=1', 'company')).toBe('example-co')
    expect(linkedinShorthand('https://example.com/ana', 'in')).toBeUndefined()
  })

  it('maps a profile to work history, degrees and skills that fit the contact schema', () => {
    const { web, companyLinkedin } = mapPerson(
      {
        linkedin_url: 'https://www.linkedin.com/in/ana-example',
        headline: 'Head of Data',
        location_full: 'Austin, Texas, United States',
        inferred_skills: ['AWS', 'Python'],
        experience: [
          {
            active_experience: 1,
            position_title: 'Head of Data',
            company_name: 'Example Co',
            date_from_year: 2021,
            company_linkedin_url: 'https://www.linkedin.com/company/example-co',
          },
          { position_title: 'Data Engineer', company_name: 'Sample Ltd', date_from_year: 2016, date_to_year: 2021 },
        ],
        education: [{ institution_name: 'State University', degree: 'BSc Computer Science', date_to_year: 2015 }],
      },
      'https://www.linkedin.com/in/ana-example',
    )
    expect(web.status).toBe('found')
    expect(web.career?.map((c) => [c.company, c.years])).toEqual([
      ['Example Co', '2021–present'],
      ['Sample Ltd', '2016–2021'],
    ])
    expect(web.education?.[0]).toMatchObject({ school: 'State University', degree: 'BSc Computer Science' })
    expect(web.keywords).toEqual(['AWS', 'Python'])
    expect(companyLinkedin).toBe('example-co')
    const parsed = ContactSchema.shape.web.safeParse({ ...web, at })
    expect(parsed.success).toBe(true)
  })

  it('maps a company with jobs, technologies and leaders that fit the contact schema', () => {
    const r = mapCompany(
      {
        company_name: 'Example Co',
        website: 'https://example.com',
        website_domain: 'example.com',
        linkedin_url: 'https://www.linkedin.com/company/example-co',
        industry: 'Software Development',
        size_range: '201-500 employees',
        employees_count: 320,
        hq_full_address: '1 Main St, Austin, Texas, US',
        technologies_used: [{ technology: 'aws' }, { technology: 'salesforce' }],
        active_job_postings: [
          { job_posting_id: 2, job_posting_title: 'Office Assistant' },
          { job_posting_id: 1, job_posting_title: 'Senior Data Engineer' },
        ],
        active_job_postings_count: 2,
        key_executives: [
          { member_full_name: 'Sam Sample', member_position_title: 'Chief Technology Officer' },
          { member_full_name: 'Lee Sample', member_position_title: 'Sales Associate' },
        ],
      },
      [
        {
          id: 1,
          title: 'Senior Data Engineer',
          location: 'Austin, TX',
          date_posted: '2026-11-01 05:00:00',
          salary: [{ min_value: 120000, max_value: 150000, currency: 'USD' }],
        },
      ],
    )
    expect(r.hiring?.[0]).toMatchObject({
      title: 'Senior Data Engineer',
      postedAt: '2026-11-01',
      location: 'Austin, TX',
    })
    expect(r.technologies?.map((t) => t.name)).toEqual(['aws', 'salesforce'])
    expect(r.leaders?.map((l) => l.name)).toEqual(['Sam Sample'])
    expect(r.hiring?.map((j) => j.title)).toEqual(['Senior Data Engineer', 'Office Assistant'])
    expect(r.size?.value).toBe('201-500 employees, 320 employees')
    const parsed = ContactSchema.shape.research.safeParse({ status: 'found', ...r, at })
    expect(parsed.success).toBe(true)
  })
})
