// app/login/page.tsx — Login page with magic link
//
// Simple email-based login using Supabase magic link.
// No password needed — user receives email with login link.

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')

    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
              P
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Pioneer<span className="text-primary">Agent</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Marketing digital con IA para su negocio
          </p>
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-6 sm:p-8">
          {status === 'sent' ? (
            // Success state
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                ¡Revise su correo!
              </h2>
              <p className="text-muted-foreground text-sm">
                Enviamos un enlace de acceso a <strong className="text-foreground">{email}</strong>. 
                Haga clic en el enlace para entrar.
              </p>
              <button
                onClick={() => { setStatus('idle'); setEmail(''); }}
                className="mt-6 text-primary hover:text-primary/80 text-sm font-medium transition-colors"
              >
                Usar otro correo
              </button>
            </div>
          ) : (
            // Login form
            <>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                Iniciar sesión
              </h2>
              <p className="text-muted-foreground text-sm mb-6">
                Ingrese su correo y le enviaremos un enlace de acceso.
              </p>

              <form onSubmit={handleLogin}>
                <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground"
                  disabled={status === 'loading'}
                />

                {status === 'error' && (
                  <p className="text-red-500 dark:text-red-400 text-sm mt-2">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading' || !email.trim()}
                  className="w-full mt-4 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
                >
                  {status === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Enviando...
                    </span>
                  ) : (
                    'Enviar enlace de acceso'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-muted-foreground text-xs mt-6">
          © {new Date().getFullYear()} Pioneer Agent · Mayagüez, Puerto Rico
        </p>
      </div>
    </div>
  )
}
