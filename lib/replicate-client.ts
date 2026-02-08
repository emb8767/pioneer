// Cliente de Replicate API para Pioneer Agent
// Genera imágenes con FLUX para posts de redes sociales
// Docs: https://replicate.com/docs
//
// CAMBIO CLAVE: useFileOutput: false
// El SDK de Replicate por defecto devuelve FileOutput objects (ReadableStream),
// que causaban el bug de NoSuchKey y URLs rotas. Con useFileOutput: false,
// replicate.run() devuelve strings directas (URLs HTTP normales).
//
// VALIDACIÓN: Después de generar, hacemos HEAD request a la URL para verificar
// que es accesible. Si falla, regeneramos automáticamente (max 1 retry).

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
  images: string[];        // URLs directas (http/https, no FileOutput)
  model: string;
  cost_real: number;       // Costo real de Replicate (acumulado si hubo retry)
  cost_client: number;     // Costo con markup 500% (acumulado si hubo retry)
  expires_in: string;      // Recordatorio de expiración
  regenerated: boolean;    // true si la primera URL falló y se regeneró
  attempts: number;        // Número de intentos (1 = éxito directo, 2 = regeneración)
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

// Máximo de intentos de generación (1 original + 1 retry)
const MAX_GENERATION_ATTEMPTS = 2;

// Timeout para HEAD validation (ms)
const HEAD_VALIDATION_TIMEOUT_MS = 5000;

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
// useFileOutput: false — devuelve strings (URLs) en vez de FileOutput objects
// Esto evita el bug de NoSuchKey y URLs rotas que teníamos antes

function getReplicateClient(): Replicate {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN no está configurada en .env.local');
  }
  return new Replicate({
    auth: token,
    useFileOutput: false,  // CRÍTICO: devuelve URLs string directas
  });
}

// === VALIDACIÓN DE URL ===
// HEAD request para verificar que la URL de Replicate es accesible
// antes de pasarla a Late.dev para publicar

async function validateImageUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEAD_VALIDATION_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return true;
    }

    // Log específico para debugging
    console.warn(`[Pioneer] URL validation failed: HTTP ${response.status} for ${url.substring(0, 80)}...`);
    return false;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[Pioneer] URL validation error: ${errorMsg} for ${url.substring(0, 80)}...`);
    return false;
  }
}

// === GENERACIÓN INTERNA (una sola llamada a Replicate) ===

async function generateOnce(
  input: GenerateImageInput,
  model: ImageModel,
  modelId: string,
): Promise<string[]> {
  const replicate = getReplicateClient();

  const numOutputs = input.num_outputs || 1;

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

  // replicate.run() con useFileOutput: false devuelve string[] directamente
  const output = await replicate.run(modelId as `${string}/${string}`, { input: replicateInput });

  // Output debería ser un array de strings (URLs directas)
  const images: string[] = [];

  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === 'string') {
        images.push(item);
      }
    }
  }

  return images;
}

// === GENERAR IMAGEN (con validación + auto-retry) ===

/**
 * Genera una o más imágenes con FLUX via Replicate.
 *
 * Flujo:
 * 1. Genera imagen con replicate.run() (useFileOutput: false → URLs string)
 * 2. Hace HEAD request para validar que la URL es accesible
 * 3. Si la URL falla validación, regenera automáticamente (max 1 retry)
 * 4. Devuelve resultado con campos regenerated/attempts/cost_client acumulados
 *
 * Las URLs de output expiran en ~1 hora.
 */
export async function generateImage(
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const model: ImageModel = input.model || 'schnell';
  const modelId = MODELS[model];
  const numOutputs = input.num_outputs || 1;
  const costPerAttempt = MODEL_COSTS[model] * numOutputs;

  let totalCostReal = 0;
  let attempts = 0;
  let regenerated = false;

  try {
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      attempts = attempt;

      console.log(`[Pioneer] Generando imagen con ${modelId} (intento ${attempt}/${MAX_GENERATION_ATTEMPTS})...`);
      console.log(`[Pioneer] Prompt: ${input.prompt.substring(0, 100)}...`);

      const images = await generateOnce(input, model, modelId);
      totalCostReal += costPerAttempt;

      if (images.length === 0) {
        console.warn(`[Pioneer] Intento ${attempt}: No se generaron imágenes`);
        if (attempt < MAX_GENERATION_ATTEMPTS) {
          console.log('[Pioneer] Reintentando generación...');
          regenerated = true;
          continue;
        }
        // Último intento, sin imágenes
        return {
          success: false,
          images: [],
          model: modelId,
          cost_real: totalCostReal,
          cost_client: totalCostReal * MARKUP,
          expires_in: '',
          regenerated,
          attempts,
          error: 'No se generaron imágenes después de múltiples intentos. Intente con un prompt diferente.',
        };
      }

      // === VALIDAR URLs con HEAD request ===
      const validImages: string[] = [];
      let hasInvalidUrl = false;

      for (const url of images) {
        const isValid = await validateImageUrl(url);
        if (isValid) {
          validImages.push(url);
        } else {
          hasInvalidUrl = true;
          console.warn(`[Pioneer] URL inválida descartada: ${url.substring(0, 80)}...`);
        }
      }

      if (validImages.length > 0) {
        // Éxito — al menos una URL válida
        const totalCostClient = totalCostReal * MARKUP;

        console.log(`[Pioneer] Imagen generada exitosamente. URLs válidas: ${validImages.length}/${images.length}. Intentos: ${attempts}. Costo cliente: $${totalCostClient.toFixed(3)}`);

        return {
          success: true,
          images: validImages,
          model: modelId,
          cost_real: totalCostReal,
          cost_client: totalCostClient,
          expires_in: '1 hora (publicar pronto o descargar)',
          regenerated,
          attempts,
        };
      }

      // Todas las URLs son inválidas
      console.warn(`[Pioneer] Intento ${attempt}: Todas las URLs fallaron validación HEAD`);

      if (attempt < MAX_GENERATION_ATTEMPTS) {
        console.log('[Pioneer] Regenerando imagen...');
        regenerated = true;
        // Pequeña pausa antes de reintentar
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Último intento, todas las URLs inválidas
      return {
        success: false,
        images: [],
        model: modelId,
        cost_real: totalCostReal,
        cost_client: totalCostReal * MARKUP,
        expires_in: '',
        regenerated: true,
        attempts,
        error: 'Las imágenes generadas no fueron accesibles (URLs inválidas). Intente de nuevo.',
      };
    }

    // No debería llegar aquí, pero por seguridad
    return {
      success: false,
      images: [],
      model: modelId,
      cost_real: totalCostReal,
      cost_client: totalCostReal * MARKUP,
      expires_in: '',
      regenerated,
      attempts,
      error: 'Error inesperado en la generación de imagen.',
    };
  } catch (error) {
    console.error('[Pioneer] Error generando imagen:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Error desconocido al generar imagen';

    return {
      success: false,
      images: [],
      model: modelId,
      cost_real: totalCostReal,
      cost_client: totalCostReal * MARKUP,
      expires_in: '',
      regenerated,
      attempts,
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
