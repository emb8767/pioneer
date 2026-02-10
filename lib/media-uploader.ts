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
// DIAGNÓSTICO: Logging detallado en cada paso para debuggear en Vercel logs.

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
    console.warn('[Pioneer Media] ❌ LATE_API_KEY no configurada, usando URL temporal');
    return temporaryUrl;
  }

  // Si ya es una URL de Late.dev, no hacer nada
  if (temporaryUrl.includes('media.getlate.dev')) {
    console.log(`[Pioneer Media] ✅ URL ya es de Late.dev, skip: ${temporaryUrl.substring(0, 60)}...`);
    return temporaryUrl;
  }

  console.log(`[Pioneer Media] === Inicio upload imagen ${index + 1} ===`);
  console.log(`[Pioneer Media] URL temporal: ${temporaryUrl.substring(0, 80)}...`);

  try {
    // === 1. Detectar formato de la imagen ===
    const extension = detectExtension(temporaryUrl);
    const contentType = extensionToMimeType(extension);
    const filename = `pioneer-img-${Date.now()}-${index}.${extension}`;

    console.log(`[Pioneer Media] Paso 1: filename=${filename}, contentType=${contentType}`);

    // === 2. Obtener presigned URL de Late.dev ===
    console.log(`[Pioneer Media] Paso 2: Solicitando presign a ${LATE_API_BASE}/media/presign...`);

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

    console.log(`[Pioneer Media] Paso 2 resultado: status=${presignResponse.status}`);

    if (!presignResponse.ok) {
      const errorText = await presignResponse.text();
      console.error(`[Pioneer Media] ❌ Presign FALLÓ (${presignResponse.status}): ${errorText}`);
      return temporaryUrl;
    }

    const presignData: PresignResponse = await presignResponse.json();
    console.log(`[Pioneer Media] Paso 2 OK: publicUrl=${presignData.publicUrl}`);
    console.log(`[Pioneer Media] Paso 2 OK: uploadUrl=${presignData.uploadUrl.substring(0, 80)}...`);

    // === 3. Descargar imagen de Replicate ===
    console.log(`[Pioneer Media] Paso 3: Descargando imagen de Replicate...`);

    const imageResponse = await fetch(temporaryUrl);

    console.log(`[Pioneer Media] Paso 3 resultado: status=${imageResponse.status}, content-type=${imageResponse.headers.get('content-type')}`);

    if (!imageResponse.ok) {
      console.error(`[Pioneer Media] ❌ Descarga FALLÓ (${imageResponse.status}) — URL temporal puede haber expirado`);
      return temporaryUrl;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const sizeKB = (imageBuffer.byteLength / 1024).toFixed(1);
    console.log(`[Pioneer Media] Paso 3 OK: ${sizeKB} KB descargados`);

    if (imageBuffer.byteLength === 0) {
      console.error(`[Pioneer Media] ❌ Imagen descargada tiene 0 bytes`);
      return temporaryUrl;
    }

    // === 4. Subir a Late.dev via presigned URL ===
    console.log(`[Pioneer Media] Paso 4: Subiendo ${sizeKB} KB a presigned URL...`);

    const uploadResponse = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: imageBuffer,
    });

    console.log(`[Pioneer Media] Paso 4 resultado: status=${uploadResponse.status}`);

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`[Pioneer Media] ❌ Upload FALLÓ (${uploadResponse.status}): ${errorText.substring(0, 200)}`);
      return temporaryUrl;
    }

    console.log(`[Pioneer Media] ✅ Upload EXITOSO: ${presignData.publicUrl}`);
    return presignData.publicUrl;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Pioneer Media] ❌ Error no manejado: ${msg}`);
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
  const total = temporaryUrls.length;
  console.log(`[Pioneer Media] === Resumen: ${uploaded}/${total} subidas a Late.dev ===`);

  if (uploaded < total) {
    const failed = permanentUrls.filter(url => !url.includes('media.getlate.dev'));
    console.warn(`[Pioneer Media] ⚠️ URLs temporales restantes: ${failed.map(u => u.substring(0, 60)).join(', ')}`);
  }

  return permanentUrls;
}

// === HELPERS ===

function detectExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(webp|png|jpg|jpeg|gif|mp4|mov)$/i);
    return match ? match[1].toLowerCase() : 'webp';
  } catch {
    return 'webp';
  }
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
