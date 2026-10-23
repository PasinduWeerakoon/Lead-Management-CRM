// Bundles the /api functions into one Lambda file: dist-lambda/index.mjs (Node.js 22, Arm64).
import { build } from 'esbuild'
import { rmSync } from 'node:fs'

rmSync('dist-lambda', { recursive: true, force: true })
await build({
  entryPoints: ['lambda/handler.ts'],
  outfile: 'dist-lambda/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // Some dependencies use require(); give the ES module bundle a working one.
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  // Optional MongoDB add-ons the app never uses (Kerberos, compression, encryption, cloud auth).
  external: [
    'kerberos',
    '@mongodb-js/zstd',
    'snappy',
    'socks',
    'aws4',
    'mongodb-client-encryption',
    'gcp-metadata',
    '@aws-sdk/credential-providers',
  ],
  logLevel: 'info',
})
