import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import type { ContentRequest, Platform } from '@/lib/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Límites de caracteres por plataforma
const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
  reddit: 40000,
  bluesky: 300,
  threads: 500,
  googlebusiness: 1500,
  telegram: 4096,
  snapchat: 250,
};

// Hashtags recomendados por plataforma
const PLATFORM_HASHTAG_COUNT: Partial<Record<Platform, number>> = {
  twitter: 3,
  instagram: 12,
  facebook: 4,
  linkedin: 4,
  tiktok: 5,
  threads: 4,
  bluesky: 3,
};

// Prompt base según tipo de post
function getPromptForType(req: ContentRequest, platform: Platform): string {
  const charLimit = PLATFORM_CHAR_LIMITS[platform];
  const base = `Negocio: ${req.business_name} (${req.business_type})
Plataforma: ${platform}
Máximo ${charLimit} caracteres.`;

  const prompts: Record<string, string> = {
    oferta: `Genera un post de redes sociales para promocionar una oferta.
${base}
Detalles de la oferta: ${req.details}
El post debe capturar atención, mencionar el beneficio claramente, y terminar con un llamado a acción.`,

    educativo: `Genera un post educativo que posicione al negocio como experto.
${base}
Tema: ${req.details}
El post debe compartir un tip útil, relacionarlo con el negocio, y ser fácil de entender.`,

    testimonio: `Genera un post basado en un testimonio de cliente.
${base}
Contexto: ${req.details}
El post debe contar una mini-historia, incluir un resultado concreto, y sentirse auténtico.`,

    detras_de_escenas: `Genera un post que muestre el lado humano del negocio.
${base}
Contexto: ${req.details}
El post debe ser casual, personal, y generar conexión emocional.`,

    urgencia: `Genera un post que impulse acción inmediata.
${base}
Situación: ${req.details}
El post debe crear urgencia, ser directo y corto, con CTA muy claro.`,

    cta: `Genera un post con un llamado a acción directo.
${base}
Acción deseada: ${req.details}
El post debe enfocarse en UN solo beneficio y dar instrucciones claras.`,

    branding: `Genera un post que presente o refuerce la marca del negocio.
${base}
Mensaje clave: ${req.details}
El post debe comunicar valores, diferenciarse, y ser inspirador.`,

    interactivo: `Genera un post interactivo que genere engagement.
${base}
Tema: ${req.details}
El post debe hacer una pregunta directa, ser fácil de responder, y ser conversacional.`,
  };

  return prompts[req.post_type] || prompts.oferta;
}

export async function POST(request: NextRequest) {
  try {
    const body: ContentRequest = await request.json();

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

    const includeHashtags = body.include_hashtags !== false;

    // Generar contenido para cada plataforma
    const platformVersions: Record<string, { text: string; char_count: number }> = {};

    for (const platform of body.platforms) {
      const prompt = getPromptForType(body, platform);
      const hashtagCount = PLATFORM_HASHTAG_COUNT[platform] || 0;

      const systemPrompt = `Eres un copywriter experto en marketing digital para pequeños negocios en Puerto Rico.
Genera contenido en español. No uses modismos de otros países latinoamericanos.
El contenido debe ser claro, directo y persuasivo.
Usa emojis con moderación (1-3 máximo).
${includeHashtags && hashtagCount > 0 ? `Incluye ${hashtagCount} hashtags relevantes al final del texto. Incluye al menos 1 hashtag local (#PR, #PuertoRico, o del municipio) y 1 de la industria.` : 'NO incluyas hashtags.'}
Responde SOLO con el texto del post, nada más. Sin comillas, sin explicaciones.`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content[0];
      if (textBlock.type !== 'text') continue;

      let text = textBlock.text.trim();

      // Extraer hashtags del texto
      const hashtagRegex = /#[\wáéíóúñÁÉÍÓÚÑ]+/g;
      const foundHashtags = text.match(hashtagRegex) || [];

      // Verificar que no exceda el límite de caracteres
      const charLimit = PLATFORM_CHAR_LIMITS[platform];
      if (text.length > charLimit) {
        text = text.substring(0, charLimit - 3) + '...';
      }

      platformVersions[platform] = {
        text,
        char_count: text.length,
      };
    }

    // Extraer hashtags del primer resultado como hashtags generales
    const firstPlatform = body.platforms[0];
    const firstText = platformVersions[firstPlatform]?.text || '';
    const hashtags = firstText.match(/#[\wáéíóúñÁÉÍÓÚÑ]+/g) || [];

    // Texto principal (del primer platform)
    const mainText = platformVersions[firstPlatform]?.text || '';

    // Costo: $0.01 por generación (markup 500% sobre ~$0.002)
    const estimatedCost = body.platforms.length * 0.01;

    return NextResponse.json({
      content: {
        text: mainText,
        hashtags,
        platform_versions: platformVersions,
      },
      metadata: {
        post_type: body.post_type,
        estimated_cost: estimatedCost,
      },
    });
  } catch (error) {
    console.error('Error generando contenido:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Error de Claude API: ${error.message}` },
        { status: error.status || 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno al generar contenido' },
      { status: 500 }
    );
  }
}
