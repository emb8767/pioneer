// app/onboarding/page.tsx — Business onboarding form (create + edit)
//
// If user has existing session → loads data for editing
// If new user → empty form for onboarding
// No Claude tokens used.

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

const inputClasses = "w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground"
const labelClasses = "block text-sm font-medium text-foreground mb-1"
const selectClasses = "w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"

export default function OnboardingPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [saved, setSaved] = useState(false)
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

  // Load user + existing business data
  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // Try to load existing business info
      try {
        const res = await fetch('/api/onboarding')
        const data = await res.json()

        if (data.exists && data.businessInfo) {
          const info = data.businessInfo
          // Check if businessType matches a predefined option
          const matchedType = BUSINESS_TYPES.find(t => t === info.business_type)

          setForm({
            businessName: data.businessName || '',
            businessType: matchedType || (info.business_type ? 'Otro' : ''),
            customType: matchedType ? '' : (info.business_type || ''),
            location: info.location || '',
            phone: info.phone || '',
            hours: info.hours || '',
            email: data.email || user.email || '',
            yearsInBusiness: info.years_in_business || '',
            description: info.description || '',
          })
          setIsEditing(true)
        } else {
          setForm(prev => ({ ...prev, email: user.email || '' }))
        }
      } catch {
        // If fetch fails, continue with empty form
        setForm(prev => ({ ...prev, email: user.email || '' }))
      }

      setStatus('ready')
    }
    loadData()
  }, [router])

  function updateField(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')
    setSaved(false)

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

      if (isEditing) {
        // Show saved confirmation, stay on page
        setSaved(true)
        setStatus('ready')
      } else {
        // New user — redirect to chat
        router.push('/chat')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error inesperado')
      setStatus('ready')
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-6 px-4 sm:py-8">
      <div className="w-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
              P
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {isEditing ? 'Perfil del negocio' : (
              <>Pioneer<span className="text-primary">Agent</span></>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isEditing
              ? 'Actualice la información de su negocio'
              : 'Cuéntenos sobre su negocio para crear su estrategia de marketing'
            }
          </p>
        </div>

        {/* Progress indicator — only for new users */}
        {!isEditing && (
          <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">1</div>
              <span className="text-sm font-medium text-primary">Datos del negocio</span>
            </div>
            <div className="w-8 h-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-medium">2</div>
              <span className="text-sm text-muted-foreground">Chat con Pioneer</span>
            </div>
          </div>
        )}

        {/* Back to chat — only when editing */}
        {isEditing && (
          <div className="mb-4">
            <button
              onClick={() => router.push('/chat')}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Volver al chat
            </button>
          </div>
        )}

        {/* Form card */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-5 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">

            {/* Business Name */}
            <div>
              <label htmlFor="businessName" className={labelClasses}>
                Nombre del negocio <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                id="businessName"
                type="text"
                value={form.businessName}
                onChange={(e) => updateField('businessName', e.target.value)}
                placeholder="Ej: Barbería Don Pedro"
                className={inputClasses}
              />
            </div>

            {/* Business Type */}
            <div>
              <label htmlFor="businessType" className={labelClasses}>
                Tipo de negocio <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <select
                id="businessType"
                value={form.businessType}
                onChange={(e) => updateField('businessType', e.target.value)}
                className={selectClasses}
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
                  className={`${inputClasses} mt-2`}
                />
              )}
            </div>

            {/* Location */}
            <div>
              <label htmlFor="location" className={labelClasses}>
                Ubicación (pueblo) <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <select
                id="location"
                value={form.location}
                onChange={(e) => updateField('location', e.target.value)}
                className={selectClasses}
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
                <label htmlFor="phone" className={labelClasses}>
                  Teléfono
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="787-555-1234"
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="hours" className={labelClasses}>
                  Horario
                </label>
                <input
                  id="hours"
                  type="text"
                  value={form.hours}
                  onChange={(e) => updateField('hours', e.target.value)}
                  placeholder="L-V 8am-5pm, S 9am-1pm"
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Two columns: Email + Years */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className={labelClasses}>
                  Email de contacto
                </label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="negocio@email.com"
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="yearsInBusiness" className={labelClasses}>
                  Años del negocio
                </label>
                <input
                  id="yearsInBusiness"
                  type="text"
                  value={form.yearsInBusiness}
                  onChange={(e) => updateField('yearsInBusiness', e.target.value)}
                  placeholder="Ej: 5 años"
                  className={inputClasses}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className={labelClasses}>
                Describa brevemente su negocio
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                ¿Qué ofrece? ¿Qué lo diferencia? ¿Quiénes son sus clientes?
              </p>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Ej: Somos una barbería familiar con 15 años de experiencia. Nos especializamos en cortes clásicos y modernos. Nuestros clientes son principalmente hombres de 18-45 años del área oeste."
                rows={4}
                className={`${inputClasses} resize-none`}
              />
            </div>

            {/* Error message */}
            {errorMsg && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-red-700 dark:text-red-400 text-sm">
                {errorMsg}
              </div>
            )}

            {/* Success message */}
            {saved && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 text-green-700 dark:text-green-400 text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Cambios guardados exitosamente.
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors text-lg"
            >
              {status === 'submitting' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </span>
              ) : isEditing ? (
                'Guardar cambios'
              ) : (
                'Continuar al chat →'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-muted-foreground text-xs mt-6">
          {isEditing
            ? 'Los cambios se reflejarán en su próxima estrategia de marketing.'
            : 'Esta información se usa para personalizar su estrategia de marketing. Puede editarla después.'
          }
        </p>
      </div>
    </div>
  )
}
