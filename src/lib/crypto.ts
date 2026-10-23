/**
 * Passphrase encryption for the AI key when you choose "remember on this device".
 * PBKDF2-SHA256 (600k iterations, per OWASP) derives an AES-GCM-256 key; salt and IV are random per save.
 */
export interface EncryptedSecret {
  salt: Uint8Array
  iv: Uint8Array
  data: Uint8Array
  iterations: number
}

const ITERATIONS = 600_000

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecret(secret: string, passphrase: string): Promise<EncryptedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)),
  )
  return { salt, iv, data, iterations: ITERATIONS }
}

/** Throws when the passphrase is wrong (AES-GCM authentication fails). */
export async function decryptSecret(enc: EncryptedSecret, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, enc.salt, enc.iterations)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: enc.iv as BufferSource },
    key,
    enc.data as BufferSource,
  )
  return new TextDecoder().decode(plain)
}
