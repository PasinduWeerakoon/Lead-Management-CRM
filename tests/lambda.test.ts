import { afterEach, describe, expect, it } from 'vitest'
import { handler, type FunctionUrlEvent } from '../lambda/handler'

const ev = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: string): FunctionUrlEvent => ({
  rawPath: path,
  rawQueryString: '',
  headers,
  body,
  requestContext: { http: { method } },
})

describe('AWS Lambda entry', () => {
  afterEach(() => {
    delete process.env.ORIGIN_VERIFY_SECRET
    delete process.env.APP_ACCESS_KEY
    delete process.env.AWS_LAMBDA_FUNCTION_NAME
  })

  it('only answers requests that came through CloudFront', async () => {
    process.env.ORIGIN_VERIFY_SECRET = 'from-cloudfront'
    expect((await handler(ev('/api/status'))).statusCode).toBe(403)
    expect((await handler(ev('/api/status', 'GET', { 'x-origin-verify': 'wrong' }))).statusCode).toBe(403)
    expect((await handler(ev('/api/status', 'GET', { 'x-origin-verify': 'from-cloudfront' }))).statusCode).toBe(200)
  })

  it('runs the same API routes on Lambda, and refuses data until sign-in is set up', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'leads-api'
    const status = await handler(ev('/api/status', 'GET', {}))
    expect(JSON.parse(status.body)).toMatchObject({ accessRequired: false, accessOk: false })
    const apollo = await handler(ev('/api/apollo', 'POST', {}, '{}'))
    expect(apollo.statusCode).toBe(503) // hosted, but GOOGLE_CLIENT_ID / SESSION_SECRET not set
    expect((await handler(ev('/api/unknown', 'GET', {}))).statusCode).toBe(404)
    delete process.env.AWS_LAMBDA_FUNCTION_NAME
  })

  it('decodes base64 bodies the way Function URLs send them', async () => {
    process.env.APP_ACCESS_KEY = 'open-sesame-123'
    const body = Buffer.from(JSON.stringify({ domain: 'not a domain' })).toString('base64')
    const res = await handler({
      ...ev('/api/research', 'POST', { 'x-app-key': 'open-sesame-123' }, body),
      isBase64Encoded: true,
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('Invalid domain.')
  })
})
