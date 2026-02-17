// app/api/onboarding/route.ts — Save/Load onboarding form data
//
// GET: Returns existing business info for the authenticated user
// POST: Creates or updates a session with user_id and business_info
// No Claude tokens used — pure database operations.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabase as adminSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Find user's session
    const { data: session } = await adminSupabase
      .from('sessions')
      .select('id, business_name, business_info, email')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!session || !session.business_info) {
      return NextResponse.json({ exists: false })
    }

    return NextResponse.json({
      exists: true,
      sessionId: session.id,
      businessName: session.business_name || '',
      businessInfo: session.business_info,
      email: session.email || user.email || '',
    })
  } catch (err) {
    console.error('[Onboarding GET] Error:', err)
    return NextResponse.json({ error: 'Error al cargar datos' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // Parse form data
    const body = await request.json()
    const {
      businessName,
      businessType,
      location,
      phone,
      hours,
      email,
      yearsInBusiness,
      description,
    } = body

    if (!businessName || !businessType || !location) {
      return NextResponse.json(
        { error: 'Nombre, tipo y ubicación son requeridos' },
        { status: 400 }
      )
    }

    // Build business_info JSON
    const businessInfo = {
      business_type: businessType,
      location,
      phone: phone || null,
      hours: hours || null,
      years_in_business: yearsInBusiness || null,
      description: description || null,
      source: 'onboarding_form',
    }

    // Check if user already has a session
    const { data: existingSession } = await adminSupabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let sessionId: string

    if (existingSession) {
      // Update existing session
      const { error: updateError } = await adminSupabase
        .from('sessions')
        .update({
          business_name: businessName,
          business_info: businessInfo,
          email: email || user.email || null,
          status: 'active',
        })
        .eq('id', existingSession.id)

      if (updateError) throw updateError
      sessionId = existingSession.id
    } else {
      // Create new session with user_id
      const { data: newSession, error: insertError } = await adminSupabase
        .from('sessions')
        .insert({
          user_id: user.id,
          business_name: businessName,
          business_info: businessInfo,
          email: email || user.email || null,
          status: 'active',
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      sessionId = newSession.id
    }

    return NextResponse.json({ success: true, sessionId })
  } catch (err) {
    console.error('[Onboarding POST] Error:', err)
    return NextResponse.json(
      { error: 'Error al guardar los datos' },
      { status: 500 }
    )
  }
}
