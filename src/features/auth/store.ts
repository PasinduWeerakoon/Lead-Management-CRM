import { create } from 'zustand'
import { MEMORY_ONLY } from '../../lib/db'

export interface AuthUser {
  email: string
  name: string
  role: 'super_admin' | 'user'
}

type Status = 'loading' | 'signed-in' | 'signed-out' | 'error'

interface AuthState {
  status: Status
  user: AuthUser | null
  /** Shown on the sign-in screen: why the last attempt failed, or why sign-in can't start. */
  message: string | null
  /** Shown after creating an account that waits for approval. */
  notice: string | null
  load: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, username: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
}

async function post(body: Record<string, string>) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  const data = res
    ? ((await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string; pending?: boolean; active?: boolean })
    : { error: 'Couldn’t reach the server. Check your connection.' }
  return { ok: !!res?.ok, ...data }
}

/**
 * Who is signed in. The server owns the session (an httpOnly cookie), so the browser only asks
 * /api/auth and never stores a token or password itself.
 */
export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  message: null,
  notice: null,

  load: async () => {
    try {
      const res = await fetch('/api/auth', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { mode: string; user: AuthUser | null }
      if (body.mode === 'broken') {
        set({ status: 'error', message: 'Sign-in isn’t set up on the server yet. Ask the administrator.' })
        return
      }
      set({ status: body.user ? 'signed-in' : 'signed-out', user: body.user, message: null })
    } catch {
      set({ status: 'error', message: 'Couldn’t reach the server. Check your connection and reload.' })
    }
  },

  signIn: async (email, password) => {
    const r = await post({ action: 'signin', email, password })
    if (r.ok && r.user) set({ status: 'signed-in', user: r.user, message: null, notice: null })
    else set({ status: 'signed-out', message: r.error ?? 'Sign-in failed. Try again.', notice: null })
  },

  signUp: async (email, username, password) => {
    const r = await post({ action: 'signup', email, username, password })
    if (!r.ok) {
      set({ message: r.error ?? 'Couldn’t create the account. Try again.', notice: null })
      return false
    }
    // The super admin's own account is active at once: sign straight in.
    if (r.active) {
      await get().signIn(email, password)
      return true
    }
    set({
      message: null,
      notice: 'Account created. The super admin needs to approve it before you can sign in.',
    })
    return true
  },

  signOut: async () => {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => undefined)
    // Workspace data held in memory must not stay on screen for the next person: start a clean page.
    if (MEMORY_ONLY) {
      window.location.assign('/')
      return
    }
    set({ status: 'signed-out', user: null, message: null, notice: null })
  },
}))
