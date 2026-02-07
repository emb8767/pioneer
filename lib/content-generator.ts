// Generador de contenido para Pioneer Agent
// Extraído de app/api/content/route.ts para uso directo (sin fetch HTTP)

import Anthropic from '@anthropic-ai/sdk';
import type { ContentRequest, Platform } from './types';

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

// Mapeo de post_type del tool (inglés) al post_type interno (español)
const POST_TYPE_MAP: Record<string, string> = {
  offer: 'oferta',
  educational: 'educativo',
  testimonial: 'testimonio',
  'behind-scenes': 'detras_de_escenas',
  urgency: 'urgencia',
  cta: 'cta',
  branding: 'branding',
  interactive: 'interactivo',
};

export interface GenerateContentInput {
  business_name: string;
  business_type: string;
  post_type: string;
  details: string;
  platforms: string[];
  tone?: string;
  include_hashtags?: boolean;
}

export interface GenerateContentResult {
  content: {
    text: string;
    hashtags: string[];
    platform_versions: Record<string, { text: string; char_count: number }>;
  };
  metadata: {
    post_type: string;
    estimated_cost: number;
  };
}

/**
 * Genera contenido de post para redes sociales.
 * Llamada directamente desde executeTool() en chat/route.ts
 * sin necesidad de fetch HTTP.
 */
export async function generateContent(
  input: GenerateContentInput
): Promise<GenerateContentResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Mapear post_type de inglés a español si es necesario
  const mappedPostType = POST_TYPE_MAP[input.post_type] || input.post_type;

  const contentRequest: ContentRequest = {
    business_name: input.business_name,
    business_type: input.business_type,
    post_type: mappedPostType as ContentRequest['post_type'],
    objective: input.details,
    details: input.details,
    platforms: input.platforms as Platform[],
    tone: input.tone === 'casual' ? 'casual' : input.tone === 'urgent' ? 'urgente' : 'formal',
    include_hashtags: input.include_hashtags !== false,
  };

  const includeHashtags = contentRequest.include_hashtags !== false;

  // Generar contenido para cada plataforma
  const platformVersions: Record<string, { text: string; char_count: number }> = {};

  for (const platform of contentRequest.platforms) {
    const prompt = getPromptForType(contentRequest, platform);
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
  const firstPlatform = contentRequest.platforms[0];
  const firstText = platformVersions[firstPlatform]?.text || '';
  const hashtags = firstText.match(/#[\wáéíóúñÁÉÍÓÚÑ]+/g) || [];

  // Texto principal (del primer platform)
  const mainText = platformVersions[firstPlatform]?.text || '';

  // Costo: $0.01 por generación (markup 500% sobre ~$0.002)
  const estimatedCost = contentRequest.platforms.length * 0.01;

  return {
    content: {
      text: mainText,
      hashtags,
      platform_versions: platformVersions,
    },
    metadata: {
      post_type: mappedPostType,
      estimated_cost: estimatedCost,
    },
  };
}
