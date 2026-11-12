import { loadEnv } from 'vite'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import vercel from './vercel.json' with { type: 'json' }
import { handleApollo } from './api/_apollo'
import { routeApi } from './api/_routes'

// Serve the production security headers from `vite preview` too, so CSP problems show up locally.
const securityHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]))

/** Server-only settings the /api functions read; never exposed to browser code (no VITE_ prefix). */
const SERVER_ENV = [
  'MONGODB_URI',
  'MONGODB_DB',
  'GOOGLE_CLIENT_ID',
  'SESSION_SECRET',
  'ALLOWED_DOMAIN',
  'ALLOWED_EMAILS',
  'OPENAI_API_KEY',
  'AI_DAILY_CAP_USD',
  'ADZUNA_APP_ID',
  'ADZUNA_APP_KEY',
  'HUNTER_API_KEY',
  'CORESIGNAL_API_KEY',
  'SUPER_ADMIN_EMAIL',
  'DATA_TABLE',
  'DATA_STORE',
  'DYNAMODB_ENDPOINT',
  'AWS_REGION',
] as const

/** Runs the same /api functions as Vercel (Apollo forwarding, profiles, shared data) in the dev and preview servers. */
function apiRoutes(): Plugin {
  type Use = (
    fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void,
  ) => void
  const mount = (addMiddleware: Use) =>
    addMiddleware(async (req, res, next) => {
      const path = (req.url ?? '').split('?')[0]
      if (!path.startsWith('/api/')) return next()
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}),
      })
      const response = path === '/api/apollo' ? await handleApollo(request) : await routeApi(path, request)
      if (!response) return next()
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(await response.text())
    })
  return {
    name: 'api-routes',
    configureServer: (server) => {
      mount(server.middlewares.use.bind(server.middlewares) as Use)
    },
    // `vite preview` too, so the production build (data in memory only) can be tried locally.
    configurePreviewServer: (server) => {
      mount(server.middlewares.use.bind(server.middlewares) as Use)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Tests set their own settings; never let .env.local (real keys, a session secret) leak into them.
  if (!process.env.VITEST) for (const k of SERVER_ENV) if (env[k] && !process.env[k]) process.env[k] = env[k]
  return {
    plugins: [react(), apiRoutes()],
    preview: { headers: securityHeaders },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Vite's dynamic-import helper must not land inside a lazy chunk, or that chunk loads eagerly.
              { name: 'preload-helper', test: /preload-helper/ },
              // Only loaded when someone exports / uses AI, so they must not join the shared vendor chunk.
              { name: 'exceljs', test: /node_modules[\\/]exceljs[\\/]/ },
              { name: 'anthropic', test: /node_modules[\\/]@anthropic-ai[\\/]/ },
              { name: 'antd', test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-[^\\/]+)[\\/]/ },
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  }
})
