// app/onboarding/page.tsx — Business onboarding form
//
// Captures basic business info WITHOUT using Claude tokens.
// After submission, saves to sessions table with user_id.
// Pioneer chat then skips basic interview and asks deeper questions only.

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const BUSINESS_TYPES = [
  'Restaurante / Comida',
  'Barbería / Salón de belleza',
  'Tienda / Retail',
  'Servicios profesionales',
  'Salud / Bienestar',
  'Automotriz',
  'Construcción / Contratista',
  'Educación / Tutorías',
  'Tecnología',
  'Entretenimiento / Eventos',
  'Otro',
]

const PR_TOWNS = [
  'Adjuntas', 'Aguada', 'Aguadilla', 'Aguas Buenas', 'Aibonito',
  'Añasco', 'Arecibo', 'Arroyo', 'Barceloneta', 'Barranquitas',
  'Bayamón', 'Cabo Rojo', 'Caguas', 'Camuy', 'Canóvanas',
  'Carolina', 'Cataño', 'Cayey', 'Ceiba', 'Ciales',
  'Cidra', 'Coamo', 'Comerío', 'Corozal', 'Culebra',
  'Dorado', 'Fajardo', 'Florida', 'Guánica', 'Guayama',
  'Guayanilla', 'Guaynabo', 'Gurabo', 'Hatillo', 'Hormigueros',
  'Humacao', 'Isabela', 'Jayuya', 'Juana Díaz', 'Juncos',
  'Lajas', 'Lares', 'Las Marías', 'Las Piedras', 'Loíza',
  'Luquillo', 'Manatí', 'Maricao', 'Maunabo', 'Mayagüez',
  'Moca', 'Morovis', 'Naguabo', 'Naranjito', 'Orocovis',
  'Patillas', 'Peñuelas', 'Ponce', 'Quebradillas', 'Rincón',
  'Río Grande', 'Sabana Grande', 'Salinas', 'San Germán', 'San Juan',
  'San Lorenzo', 'San Sebastián', 'Santa Isabel', 'Toa Alta', 'Toa Baja',
  'Trujillo Alto', 'Utuado', 'Vega Alta', 'Vega Baja', 'Vieques',
  'Villalba', 'Yabucoa', 'Yauco',
]

interface FormData {
  businessName: string
  businessType: string
  customType: string
  location: string
  phone: string
  hours: string
  email: string
  yearsInBusiness: string
  description: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<FormData>({
    businessName: '',
    businessType: '',
    customType: '',
    location: '',
    phone: '',
    hours: '',
    email: '',
    yearsInBusiness: '',
    description: '',
  })

  // Load user email from auth session
  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setForm(prev => ({ ...prev, email: user.email || '' }))
      setStatus('ready')
    }
    loadUser()
  }, [router])

  function updateField(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    // Validation
    if (!form.businessName.trim()) {
      setErrorMsg('El nombre del negocio es requerido.')
      setStatus('ready')
      return
    }
    if (!form.businessType) {
      setErrorMsg('Seleccione el tipo de negocio.')
      setStatus('ready')
      return
    }
    if (!form.location) {
      setErrorMsg('Seleccione la ubicación.')
      setStatus('ready')
      return
    }

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          businessType: form.businessType === 'Otro' ? form.customType.trim() : form.businessType,
          location: form.location,
          phone: form.phone.trim(),
          hours: form.hours.trim(),
          email: form.email.trim(),
          yearsInBusiness: form.yearsInBusiness.trim(),
          description: form.description.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Error al guardar los datos')
      }

      // Success — redirect to chat
      router.push('/chat')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error inesperado')
      setStatus('ready')
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white py-8 px-4">
      <div className="w-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Pioneer<span className="text-blue-600">Agent</span>
          </h1>
          <p className="text-gray-500 mt-2">
            Cuéntenos sobre su negocio para crear su estrategia de marketing
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">1</div>
            <span className="text-sm font-medium text-blue-600">Datos del negocio</span>
          </div>
          <div className="w-8 h-px bg-gray-300" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-sm font-medium">2</div>
            <span className="text-sm text-gray-400">Chat con Pioneer</span>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Business Name */}
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1">
                Nombre del negocio <span className="text-red-500">*</span>
              </label>
              <input
                id="businessName"
                type="text"
                value={form.businessName}
                onChange={(e) => updateField('businessName', e.target.value)}
                placeholder="Ej: Barbería Don Pedro"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
              />
            </div>

            {/* Business Type */}
            <div>
              <label htmlFor="businessType" className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de negocio <span className="text-red-500">*</span>
              </label>
              <select
                id="businessType"
                value={form.businessType}
                onChange={(e) => updateField('businessType', e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
              >
                <option value="">Seleccione...</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {form.businessType === 'Otro' && (
                <input
                  type="text"
                  value={form.customType}
                  onChange={(e) => updateField('customType', e.target.value)}
                  placeholder="Describa su tipo de negocio"
                  className="w-full mt-2 px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              )}
            </div>

            {/* Location */}
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
                Ubicación (pueblo) <span className="text-red-500">*</span>
              </label>
              <select
                id="location"
                value={form.location}
                onChange={(e) => updateField('location', e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
              >
                <option value="">Seleccione su pueblo...</option>
                {PR_TOWNS.map((town) => (
                  <option key={town} value={town}>{town}</option>
                ))}
              </select>
            </div>

            {/* Two columns: Phone + Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Teléfono
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="787-555-1234"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label htmlFor="hours" className="block text-sm font-medium text-gray-700 mb-1">
                  Horario
                </label>
                <input
                  id="hours"
                  type="text"
                  value={form.hours}
                  onChange={(e) => updateField('hours', e.target.value)}
                  placeholder="L-V 8am-5pm, S 9am-1pm"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
            </div>

            {/* Two columns: Email + Years */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email de contacto
                </label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="negocio@email.com"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-gray-700 mb-1">
                  Años del negocio
                </label>
                <input
                  id="yearsInBusiness"
                  type="text"
                  value={form.yearsInBusiness}
                  onChange={(e) => updateField('yearsInBusiness', e.target.value)}
                  placeholder="Ej: 5 años"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Describa brevemente su negocio
              </label>
              <p className="text-xs text-gray-400 mb-2">
                ¿Qué ofrece? ¿Qué lo diferencia? ¿Quiénes son sus clientes?
              </p>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Ej: Somos una barbería familiar con 15 años de experiencia. Nos especializamos en cortes clásicos y modernos. Nuestros clientes son principalmente hombres de 18-45 años del área oeste."
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-400 resize-none"
              />
            </div>

            {/* Error message */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-lg"
            >
              {status === 'submitting' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </span>
              ) : (
                'Continuar al chat →'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          Esta información se usa para personalizar su estrategia de marketing.
          Puede editarla después.
        </p>
      </div>
    </div>
  )
}
