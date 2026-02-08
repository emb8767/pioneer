// Media Uploader para Pioneer Agent
// Sube imágenes temporales (Replicate) a Late.dev via presigned URLs
// para obtener URLs permanentes de media.getlate.dev
//
// Flujo:
// 1. POST /v1/media/presign → {uploadUrl, publicUrl}
// 2. Descargar imagen de Replicate URL temporal
// 3. PUT uploadUrl con el binary
// 4. Retornar publicUrl permanente
//
// Docs: https://docs.getlate.dev/resources/migrations/migrating-from-ayrshare#step-5-update-media-uploads

const LATE_API_BASE = 'https://getlate.dev/api/v1';

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
}

/**
 * Sube una imagen desde una URL temporal a Late.dev storage.
 * Retorna la URL permanente de media.getlate.dev.
 * Si falla, retorna la URL original (graceful degradation).
 */
export async function uploadToLateMedia(
  temporaryUrl: string,
  index: number = 0
): Promise<string> {
  const apiKey = process.env.LATE_API_KEY;
  if (!apiKey) {
    console.warn('[Pioneer] LATE_API_KEY no configurada, usando URL temporal');
    return temporaryUrl;
  }

  try {
    // === 1. Detectar formato de la imagen ===
    const extension = detectExtension(temporaryUrl);
    const contentType = extensionToMimeType(extension);
    const filename = `pioneer-img-${Date.now()}-${index}.${extension}`;

    console.log(`[Pioneer] Media upload: Subiendo imagen ${index + 1} a Late.dev (${filename})...`);

    // === 2. Obtener presigned URL de Late.dev ===
    const presignResponse = await fetch(`${LATE_API_BASE}/media/presign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        contentType,
      }),
    });

    if (!presignResponse.ok) {
      const errorText = await presignResponse.text();
      console.error(`[Pioneer] Media presign failed (${presignResponse.status}): ${errorText}`);
      return temporaryUrl;
    }

    const presignData: PresignResponse = await presignResponse.json();
    console.log(`[Pioneer] Media presign OK: publicUrl=${presignData.publicUrl.substring(0, 60)}...`);

    // === 3. Descargar imagen de Replicate ===
    const imageResponse = await fetch(temporaryUrl);
    if (!imageResponse.ok) {
      console.error(`[Pioneer] No se pudo descargar imagen de Replicate (${imageResponse.status})`);
      return temporaryUrl;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    console.log(`[Pioneer] Imagen descargada: ${(imageBuffer.byteLength / 1024).toFixed(1)} KB`);

    // === 4. Subir a Late.dev via presigned URL ===
    const uploadResponse = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`[Pioneer] Media upload failed (${uploadResponse.status}): ${errorText}`);
      return temporaryUrl;
    }

    console.log(`[Pioneer] Media upload OK: ${presignData.publicUrl}`);
    return presignData.publicUrl;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Pioneer] Media upload error: ${msg}`);
    // Graceful degradation: retornar URL temporal
    return temporaryUrl;
  }
}

/**
 * Sube múltiples imágenes a Late.dev.
 * Retorna array de URLs permanentes (o temporales si falla alguna).
 */
export async function uploadAllToLateMedia(
  temporaryUrls: string[]
): Promise<string[]> {
  const permanentUrls: string[] = [];

  for (let i = 0; i < temporaryUrls.length; i++) {
    const permanentUrl = await uploadToLateMedia(temporaryUrls[i], i);
    permanentUrls.push(permanentUrl);
  }

  const uploaded = permanentUrls.filter(url => url.includes('media.getlate.dev')).length;
  console.log(`[Pioneer] Media upload completado: ${uploaded}/${temporaryUrls.length} subidas a Late.dev`);

  return permanentUrls;
}

// === HELPERS ===

function detectExtension(url: string): string {
  // Extraer extensión de la URL (antes de query params)
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(webp|png|jpg|jpeg|gif|mp4|mov)$/i);
  return match ? match[1].toLowerCase() : 'webp';
}

function extensionToMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  };
  return mimeTypes[ext] || 'image/webp';
}
