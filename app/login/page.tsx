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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Pioneer<span className="text-blue-600">Agent</span>
          </h1>
          <p className="text-gray-500 mt-2">
            Marketing digital con IA para su negocio
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {status === 'sent' ? (
            // Success state
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                ¡Revise su correo!
              </h2>
              <p className="text-gray-500">
                Enviamos un enlace de acceso a <strong>{email}</strong>. 
                Haga clic en el enlace para entrar.
              </p>
              <button
                onClick={() => { setStatus('idle'); setEmail(''); }}
                className="mt-6 text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                Usar otro correo
              </button>
            </div>
          ) : (
            // Login form
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">
                Iniciar sesión
              </h2>
              <p className="text-gray-500 text-sm mb-6">
                Ingrese su correo y le enviaremos un enlace de acceso.
              </p>

              <form onSubmit={handleLogin}>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                  disabled={status === 'loading'}
                />

                {status === 'error' && (
                  <p className="text-red-500 text-sm mt-2">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading' || !email.trim()}
                  className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {status === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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

        <p className="text-center text-gray-400 text-xs mt-6">
          © {new Date().getFullYear()} Pioneer Agent · Mayagüez, Puerto Rico
        </p>
      </div>
    </div>
  )
}
