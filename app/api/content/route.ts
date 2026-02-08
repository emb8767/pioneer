// API pública de contenido para Pioneer Agent
// Delegamos a generateContent() de content-generator.ts para evitar duplicación.
// Este endpoint es un wrapper HTTP — la lógica real vive en lib/content-generator.ts.

import { NextRequest, NextResponse } from 'next/server';
import { generateContent } from '@/lib/content-generator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validar campos requeridos
    if (
      !body.business_name ||
      !body.business_type ||
      !body.post_type ||
      !body.details ||
      !body.platforms?.length
    ) {
      return NextResponse.json(
        {
          error:
            'Faltan campos requeridos: business_name, business_type, post_type, details, platforms',
        },
        { status: 400 }
      );
    }

    const result = await generateContent({
      business_name: body.business_name,
      business_type: body.business_type,
      post_type: body.post_type,
      details: body.details,
      platforms: body.platforms,
      tone: body.tone || 'professional',
      include_hashtags: body.include_hashtags !== false,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error generando contenido:', error);

    return NextResponse.json(
      { error: 'Error interno al generar contenido' },
      { status: 500 }
    );
  }
}
