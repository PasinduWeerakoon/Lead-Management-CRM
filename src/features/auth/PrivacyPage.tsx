import { Link } from 'react-router-dom'
import { useAuth } from './store'
import { CORESIGNAL_ONLY } from '../../lib/research/coresignal'

/** Fill these in before going live. */
const LAST_UPDATED = '[DATE]'
const PRIVACY_CONTACT = '[1BT PRIVACY CONTACT EMAIL]'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      {children}
    </section>
  )
}

const B = ({ children }: { children: React.ReactNode }) => (
  <b style={{ color: 'var(--text)', fontWeight: 500 }}>{children}</b>
)

/** Privacy policy and PDPA notice. Public: readable before signing in. */
export function PrivacyPage() {
  const signedIn = useAuth((s) => s.status === 'signed-in')
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg)',
        color: 'var(--text-2)',
        fontSize: 15,
        lineHeight: 1.65,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 32px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-header)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Leads Manager</span>
        <Link to="/">{signedIn ? 'Back to the app' : 'Back to sign in'}</Link>
      </header>
      <main
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '40px 24px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, color: 'var(--text)' }}>Privacy policy</h1>
          <p style={{ margin: 0, color: 'var(--text-3)' }}>
            Leads Manager, an internal tool of 1 Billion Technology. Last updated {LAST_UPDATED}.
          </p>
        </div>

        <Section title="Who is responsible">
          <p style={{ margin: 0 }}>
            1 Billion Technology ("1BT") decides why and how personal data is used in this tool and is the controller
            under the Personal Data Protection Act, No. 9 of 2022 of Sri Lanka (PDPA). Questions and requests go to{' '}
            {PRIVACY_CONTACT}.
          </p>
        </Section>

        <Section title="What data the tool uses">
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <B>Your account:</B> your name, work email and Google profile picture, taken from Google when you sign in.
            </li>
            <li>
              <B>Your LinkedIn connections:</B> names, job titles, companies, profile links and connection dates from
              the Connections.csv file you upload.
            </li>
            <li>
              {CORESIGNAL_ONLY ? (
                <>
                  <B>Work information from Coresignal:</B> career history, degrees, certifications and skills for each
                  connection, matched by the LinkedIn profile link in your file, and company records, technologies and
                  open job posts for their employers. A work email is kept only when Coresignal holds one for that
                  person. Coresignal is a licensed data provider. The tool also reads each employer's own public website
                  and careers pages, and the job boards those pages link to (such as Greenhouse or Lever), and skips any
                  page the site asks bots not to read. Company facts are also checked against official and open records
                  (SEC EDGAR and Wikidata). Every fact keeps its source. The tool runs no web or LinkedIn searches.
                </>
              ) : (
                <>
                  <B>Public work information:</B> company websites, open job ads, technologies, and public career
                  history, degrees, projects, certifications and public GitHub profiles found on the open web, plus
                  official and open company records (SEC EDGAR, Wikidata), job listings (company job boards and Adzuna)
                  and work email lookups (Hunter.io). Work email and office phone are kept only when the person or their
                  employer published them on a public page. Each fact keeps a link to where it was found.
                </>
              )}
            </li>
            <li>
              <B>Your notes:</B> status, tags and notes you add, and the searches you run.
            </li>
            <li>
              <B>Activity records:</B> sign in times and main actions, kept to protect the data and to answer PDPA
              requests.
            </li>
          </ul>
          <p style={{ margin: 0 }}>
            The tool does not collect home addresses, personal email or phone numbers, family details, health, religion,
            political views or any other special category data.{' '}
            {CORESIGNAL_ONLY
              ? "The tool never visits LinkedIn, never logs in to LinkedIn and never uses anyone's account. People without a LinkedIn profile link in your file are not looked up."
              : "Public LinkedIn pages are used only when a web search returns them (job posts, company pages, public profiles). The tool never logs in to LinkedIn or uses anyone's account. Indeed and Glassdoor are never used."}
          </p>
        </Section>

        <Section title="Why it is used">
          <p style={{ margin: 0 }}>
            To help 1BT staff find business contacts who may need 1BT's services. The legal basis is 1BT's legitimate
            business interest in contacting professionals about work matters. Data is not sold, and is not used for any
            other purpose.
          </p>
        </Section>

        <Section title="Where the data is kept">
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <B>In your browser:</B> connections, collected web data, notes and search results are stored in your own
              browser on your own device.
            </li>
            <li>
              <B>Cloud sync, if turned on:</B> a copy is kept in 1BT's database so it can be shared with your team.
            </li>
            {CORESIGNAL_ONLY && (
              <li>
                <B>Coresignal lookups:</B> to collect work data, the LinkedIn profile link of each connection and the
                name or website of each company are sent to Coresignal through 1BT's server. Nothing else from your file
                is sent.
              </li>
            )}
            <li>
              <B>AI processing:</B> to score searches{CORESIGNAL_ONLY ? '' : ' and collect web data'}, names, job titles
              and company names are sent to the AI provider (OpenAI) through 1BT's server. The provider does not keep
              this data to train its models.
            </li>
          </ul>
        </Section>

        <Section title="How long it is kept">
          <p style={{ margin: 0 }}>
            Collected web data is refreshed every 30 days and job ads every 7. Activity records are kept for 12 months.
            You can delete connections, searches or a whole profile at any time. Clearing your browser data removes
            everything stored in that browser.
          </p>
        </Section>

        <Section title="Rights under the PDPA">
          <p style={{ margin: 0 }}>
            Anyone whose data is in this tool can ask 1BT to see it, correct it, delete it, or stop it being used. Send
            the request to {PRIVACY_CONTACT}. 1BT will reply within 21 working days. If you are not satisfied, you can
            complain to the Data Protection Authority of Sri Lanka.
          </p>
          {CORESIGNAL_ONLY && (
            <p style={{ margin: 0 }}>
              Deleting data here removes it from this tool only. To have a profile removed from Coresignal itself, the
              person can also contact Coresignal directly through its own privacy page.
            </p>
          )}
        </Section>

        <Section title="How it is protected">
          <p style={{ margin: 0 }}>
            Only approved 1BT Google accounts can sign in. Connections are encrypted between your browser and the
            server. Every fact keeps its source so wrong data can be found and removed.
          </p>
        </Section>

        <section
          style={{
            background: 'rgba(217,119,6,.08)',
            border: '1px solid rgba(217,119,6,.35)',
            borderRadius: 12,
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--warning)' }}>Developer note</h2>
          <p style={{ margin: 0 }}>
            This tool was built by Pasindu Weerakoon to 1BT's requirements, for use by 1BT. The developer does not
            store, receive or have access to any data from this tool in personal accounts, personal databases or
            personal devices. Data stays in each user's browser, or in 1BT's own systems when cloud sync is on.
          </p>
          <p style={{ margin: 0 }}>
            1BT, as the controller, is responsible for how the tool is used and for the data in it. The developer
            accepts no responsibility for any data leak, loss or misuse that results from how the tool is used, from
            users' devices or browsers, or from 1BT's systems and accounts.
          </p>
        </section>
      </main>
    </div>
  )
}
