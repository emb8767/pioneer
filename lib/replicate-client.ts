// Cliente de Replicate API para Pioneer Agent
// Genera imágenes con FLUX para posts de redes sociales
// Docs: https://replicate.com/docs

import Replicate from 'replicate';
import type { Platform } from './types';

// === TIPOS ===

export type AspectRatio = '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21';
export type OutputFormat = 'webp' | 'jpg' | 'png';
export type ImageModel = 'schnell' | 'pro';

export interface GenerateImageInput {
  prompt: string;
  model?: ImageModel;
  aspect_ratio?: AspectRatio;
  num_outputs?: number;
  output_format?: OutputFormat;
  output_quality?: number;
  seed?: number;
}

export interface GenerateImageResult {
  success: boolean;
  images: string[];        // URLs temporales (expiran en 1 hora)
  model: string;
  cost_real: number;       // Costo real de Replicate
  cost_client: number;     // Costo con markup 500%
  expires_in: string;      // Recordatorio de expiración
  error?: string;
}

// === MODELOS ===

const MODELS: Record<ImageModel, string> = {
  schnell: 'black-forest-labs/flux-schnell',
  pro: 'black-forest-labs/flux-1.1-pro',
};

// Costo real por imagen
const MODEL_COSTS: Record<ImageModel, number> = {
  schnell: 0.003,
  pro: 0.055,
};

// Markup 500%
const MARKUP = 5;

// === ASPECT RATIOS RECOMENDADOS POR PLATAFORMA ===

export const PLATFORM_ASPECT_RATIOS: Partial<Record<Platform, AspectRatio>> = {
  instagram: '4:5',      // Ocupa más pantalla en el feed
  facebook: '1:1',       // Cuadrado funciona bien
  twitter: '16:9',       // Landscape
  linkedin: '1:1',       // Profesional
  tiktok: '9:16',        // Vertical
  pinterest: '2:3',      // Vertical
  threads: '1:1',        // Cuadrado
  youtube: '16:9',       // Landscape
  bluesky: '16:9',       // Landscape
  googlebusiness: '1:1', // Cuadrado
};

// === CLIENTE ===

function getReplicateClient(): Replicate {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN no está configurada en .env.local');
  }
  return new Replicate({ auth: token });
}

// === GENERAR IMAGEN ===

/**
 * Genera una o más imágenes con FLUX via Replicate.
 * 
 * Las URLs de output expiran en 1 hora.
 * Para publicación inmediata: pasar URL directo a Late.dev como media_url.
 * Para publicación programada >1h: futuro — descargar y re-hostear en Supabase Storage.
 */
export async function generateImage(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const model: ImageModel = input.model || 'schnell';
  const modelId = MODELS[model];
  const numOutputs = input.num_outputs || 1;

  try {
    const replicate = getReplicateClient();

    // Construir input para Replicate
    const replicateInput: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio || '1:1',
      num_outputs: numOutputs,
      output_format: input.output_format || 'webp',
      output_quality: input.output_quality || 80,
    };

    // Seed opcional (para reproducibilidad)
    if (input.seed !== undefined) {
      replicateInput.seed = input.seed;
    }

    // FLUX schnell: go_fast para máxima velocidad
    if (model === 'schnell') {
      replicateInput.go_fast = true;
    }

    console.log(`[Pioneer] Generando imagen con ${modelId}...`);
    console.log(`[Pioneer] Prompt: ${input.prompt.substring(0, 100)}...`);

    // replicate.run() es sync por defecto (Prefer: wait, hasta 60s)
    // FLUX schnell genera en ~1-4 segundos
    const output = await replicate.run(modelId as `${string}/${string}`, { input: replicateInput });

    // Output es un array de FileOutput objects
    // Extraer URLs de cada output
    const images: string[] = [];

    if (Array.isArray(output)) {
      for (const item of output) {
        // FileOutput tiene .url() method, o puede ser string directo
        if (typeof item === 'string') {
          images.push(item);
        } else if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'function') {
          const url = item.url();
          if (url) images.push(url.toString());
        } else if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
          images.push(item.url);
        }
      }
    }

    if (images.length === 0) {
      return {
        success: false,
        images: [],
        model: modelId,
        cost_real: 0,
        cost_client: 0,
        expires_in: '',
        error: 'No se generaron imágenes. Intente con un prompt diferente.',
      };
    }

    const costReal = MODEL_COSTS[model] * numOutputs;
    const costClient = costReal * MARKUP;

    console.log(`[Pioneer] Imagen generada exitosamente. URLs: ${images.length}`);

    return {
      success: true,
      images,
      model: modelId,
      cost_real: costReal,
      cost_client: costClient,
      expires_in: '1 hora (publicar pronto o descargar)',
    };
  } catch (error) {
    console.error('[Pioneer] Error generando imagen:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Error desconocido al generar imagen';

    return {
      success: false,
      images: [],
      model: modelId,
      cost_real: 0,
      cost_client: 0,
      expires_in: '',
      error: errorMessage,
    };
  }
}

// === HELPERS ===

/**
 * Sugiere el mejor aspect ratio basado en las plataformas del cliente.
 * Si hay múltiples plataformas, usa 1:1 (funciona en todas).
 */
export function suggestAspectRatio(platforms: Platform[]): AspectRatio {
  if (platforms.length === 0) return '1:1';
  if (platforms.length === 1) {
    return PLATFORM_ASPECT_RATIOS[platforms[0]] || '1:1';
  }
  // Múltiples plataformas: 1:1 es el más universal
  return '1:1';
}

/**
 * Genera un prompt de imagen optimizado para marketing.
 * Toma el contexto del negocio y crea un prompt en inglés
 * (FLUX funciona mejor con prompts en inglés).
 */
export function buildImagePrompt(
  businessName: string,
  businessType: string,
  description: string,
  style?: 'photo' | 'illustration' | 'flat-design'
): string {
  const styleMap = {
    photo: 'professional photograph, high quality, commercial photography, well-lit',
    illustration: 'digital illustration, colorful, modern, clean design',
    'flat-design': 'flat design, minimalist, modern, clean, vector style',
  };

  const styleStr = styleMap[style || 'photo'];

  // FLUX funciona mejor con prompts en inglés, descriptivos
  return `${styleStr}, ${description}, for a ${businessType} called "${businessName}", social media marketing image, vibrant, appetizing, inviting, no text overlay`;
}

/**
 * Devuelve el costo al cliente por modelo.
 */
export function getImageCost(model: ImageModel = 'schnell'): number {
  return MODEL_COSTS[model] * MARKUP;
}
