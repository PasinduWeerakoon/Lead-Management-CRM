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

  it('runs the same API routes and enforces the access code on Lambda', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'leads-api'
    process.env.APP_ACCESS_KEY = 'open-sesame-123'
    const status = await handler(ev('/api/status', 'GET', { 'x-app-key': 'open-sesame-123' }))
    expect(JSON.parse(status.body)).toMatchObject({ accessRequired: true, accessOk: true })
    const research = await handler(
      ev('/api/research', 'POST', { 'content-type': 'application/json' }, JSON.stringify({ domain: 'contoso.com' })),
    )
    expect(research.statusCode).toBe(401)
    const apollo = await handler(ev('/api/apollo', 'POST', { 'x-app-key': 'open-sesame-123' }, '{}'))
    expect(apollo.statusCode).toBe(401) // no Apollo key in the request
    expect((await handler(ev('/api/unknown', 'GET', { 'x-app-key': 'open-sesame-123' }))).statusCode).toBe(404)
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
