import { create } from 'zustand'

export interface AuthUser {
  email: string
  name: string
  picture?: string
}

type Status = 'loading' | 'signed-in' | 'signed-out' | 'error'

interface AuthState {
  status: Status
  user: AuthUser | null
  clientId: string | null
  /** Shown on the sign-in screen: why the last attempt failed, or why sign-in can't start. */
  message: string | null
  load: () => Promise<void>
  signInWithGoogle: (credential: string) => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Who is signed in. The server owns the session (an httpOnly cookie), so the browser only asks
 * /api/auth and never stores a token itself.
 */
export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  clientId: null,
  message: null,

  load: async () => {
    try {
      const res = await fetch('/api/auth', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { mode: string; clientId: string | null; user: AuthUser | null }
      if (body.mode === 'broken') {
        set({ status: 'error', message: 'Sign-in isn’t set up on the server yet. Ask the administrator.' })
        return
      }
      set({ status: body.user ? 'signed-in' : 'signed-out', user: body.user, clientId: body.clientId, message: null })
    } catch {
      set({ status: 'error', message: 'Couldn’t reach the server. Check your connection and reload.' })
    }
  },

  signInWithGoogle: async (credential) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    }).catch(() => null)
    const body = res ? ((await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string }) : {}
    if (res?.ok && body.user) set({ status: 'signed-in', user: body.user, message: null })
    else set({ status: 'signed-out', message: body.error ?? 'Sign-in failed. Try again.' })
  },

  signOut: async () => {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => undefined)
    set({ status: 'signed-out', user: null, message: null })
  },
}))
