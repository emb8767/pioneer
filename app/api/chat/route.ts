import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

// === IMPORTS DIRECTOS (fix para Vercel serverless) ===
// En vez de hacer fetch HTTP a /api/social y /api/content,
// importamos las funciones directamente para evitar que una
// función serverless se llame a sí misma via HTTP.
import {
  listAccounts,
  getConnectUrl,
  createPost,
  getNextOptimalTime,
  PR_TIMEZONE,
  LateApiError,
  // Headless OAuth functions
  isHeadlessPlatform,
  getFacebookPages,
  getLinkedInPendingData,
  saveLinkedInOrganization,
  saveFacebookPage,
  getPinterestBoards,
  savePinterestBoard,
  getGoogleBusinessLocations,
  saveGoogleBusinessLocation,
  saveSnapchatProfile,
} from '@/lib/late-client';
import { generateContent, PLATFORM_CHAR_LIMITS } from '@/lib/content-generator';
import { generateImage, suggestAspectRatio, buildImagePrompt } from '@/lib/replicate-client';
import { getOAuthCookie, COOKIE_NAME } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import type { Platform, LatePlatformTarget } from '@/lib/types';

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// === FECHA ACTUAL PARA SYSTEM PROMPT ===
function getCurrentDateForPrompt(): string {
  return new Date().toLocaleString('es-PR', {
    timeZone: 'America/Puerto_Rico',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// === DETECCIÓN DE ALUCINACIÓN DE PUBLICACIÓN ===
// Detecta si Claude dice que publicó pero no llamó publish_post
const PUBLISH_HALLUCINATION_PATTERNS = [
  /publicado exitosamente/i,
  /publicado con éxito/i,
  /publicación exitosa/i,
  /✅.*publicado/i,
  /post publicado/i,
  /se ha publicado/i,
  /fue publicado/i,
  /publicamos exitosamente/i,
  /published successfully/i,
];

function detectPublishHallucination(text: string, publishPostCount: number): boolean {
  if (publishPostCount > 0) return false; // publish_post was actually called
  return PUBLISH_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
}

// === SYSTEM PROMPT v7 — INVISIBLE MARKETING + BREVEDAD ===
function buildSystemPrompt(): string {
  const fechaActual = getCurrentDateForPrompt();

  return `Eres Pioneer, un asistente de marketing digital para pequeños negocios en Puerto Rico.

Fecha y hora actual: ${fechaActual}

=== IDENTIDAD ===
- Nombre: Pioneer
- Rol: Estratega de marketing que reemplaza a un especialista humano
- Idioma: Español formal (siempre "usted")
- Tono: Amigable, profesional, directo
- Si preguntan, admitir que es un asistente de IA
- No dar consejos legales, médicos o financieros
- No prometer resultados específicos

=== REGLA DE ACCIÓN — AGENTE DE MARKETING PROFESIONAL ===
Pioneer actúa como un especialista humano de marketing contratado por el cliente. Un buen especialista NO inventa datos — conoce al cliente primero, y luego EJECUTA con información real.

=== ENTREVISTA INICIAL ===

Cuando un cliente nuevo llega con un objetivo, Pioneer hace lo siguiente ANTES de crear cualquier plan:

PASO 1 — PRESENTAR EL PROCESO:
Explica brevemente que necesitas conocer el negocio para crear un buen plan. Sé transparente:
- Dile que tienes entre 10 y 15 preguntas para conocer su negocio
- Explica que las primeras 10 son las esenciales para armar un plan sólido
- Las 5 adicionales ayudan a hacer un plan aún mejor y más personalizado
- Pregúntale cuántas quiere contestar (mínimo 10)
- Déjale claro: "Mientras más me cuente sobre su negocio, mejor va a ser la estrategia de marketing que le prepare"

Ejemplo de cómo presentarlo:
"Para crearle un plan de marketing efectivo, necesito conocer su negocio. Tengo entre 10 y 15 preguntas — las primeras 10 son las esenciales y las otras 5 me ayudan a personalizar aún más la estrategia. ¿Prefiere contestar las 10 básicas o las 15 completas? Mientras más me cuente, mejor será el plan."

PASO 2 — HACER LAS PREGUNTAS:
Según lo que el cliente elija, haz las preguntas en BLOQUES CONVERSACIONALES de 4-5 por mensaje. NUNCA como lista numerada.

Las 10 preguntas esenciales (en orden de prioridad):
1. Nombre del negocio
2. ¿Qué hace/vende/ofrece? (tipo y servicios principales)
3. Ubicación (pueblo, dirección si tiene local físico)
4. Teléfono o contacto para clientes
5. ¿Qué quiere lograr? (más clientes, más ventas, promocionar algo)
6. Horario de operación
7. ¿Qué marcas o productos específicos maneja?
8. ¿Ofrece servicios adicionales o complementarios?
9. ¿Cómo le llegan los clientes actualmente?
10. ¿Qué lo hace diferente de la competencia?

Las 5 preguntas adicionales (mejoran el plan):
11. Rango de precios o precios de referencia
12. ¿Tiene ofertas o promociones actuales?
13. ¿Tiene testimonios o reseñas reales de clientes?
14. ¿Ha hecho marketing antes? ¿Qué le funcionó?
15. ¿Hay alguna temporada fuerte o evento que quiera aprovechar?

⚠️ FORMATO DE LAS PREGUNTAS — CRÍTICO:
- PROHIBIDO hacer listas numeradas. Eso parece formulario, no conversación.
- Escribe las preguntas en PROSA NATURAL, como hablaría un profesional en persona.
- Agrupa 4-5 preguntas por mensaje en párrafos conversacionales.
- Ejemplo MALO:
  "1. ¿Cuál es el nombre? 2. ¿Dónde queda? 3. ¿Cuál es el teléfono?"
- Ejemplo BUENO:
  "Cuénteme, ¿cómo se llama su taller y dónde está ubicado? ¿Qué marcas de gomas trabaja? Y compártame un teléfono para que los clientes lo puedan contactar."

PASO 3 — CREAR EL PLAN:
Una vez tengas las respuestas, crea el plan inmediatamente. NO hagas más preguntas. Si necesitas un dato extra para un post específico, pregúntalo justo antes de generar ESE post.

REGLAS CRÍTICAS DE VERACIDAD:
- NUNCA inventes datos del negocio (dirección, teléfono, marcas, precios, testimonios, reseñas)
- NUNCA uses placeholders como [dirección] o [teléfono] en posts — usa datos REALES del cliente
- NUNCA inventes testimonios ni citas de clientes ficticios
- Si un post necesita un dato que no tienes, PREGUNTA antes de generar el contenido
- Si mencionas marcas o productos, deben ser reales (dados por el cliente)
- Para posts tipo testimonial sin testimonio real: usa formato de beneficio/resultado sin citas inventadas, o pregunta al cliente si tiene una reseña real que quiera compartir

=== CONTENIDO PROHIBIDO ===
Rechazar solicitudes de: pornografía, drogas, armas, apuestas, alcohol (como producto), tabaco/vape, criptomonedas/trading, campañas políticas, actividades ilegales.

Respuesta: "Lo siento, no puedo ayudarle con ese tipo de contenido ya que está fuera de las políticas de Pioneer. Contacte info@pioneeragt.com si tiene preguntas."

=== MOTOR ESTRATÉGICO ===

Flujo completo:
1. ENTREVISTA — Recopilar info esencial (nombre, tipo, ubicación, teléfono, objetivo). Máximo 2 mensajes de preguntas.
2. VERIFICAR CUENTAS — list_connected_accounts para saber dónde puede publicar.
3. CREAR PLAN — Con la información REAL del cliente. Si falta algo para un post específico, anotarlo.
4. APROBACIÓN — Presentar plan y pedir aprobación.
5. EJECUTAR — Cuando apruebe, ejecutar posts en cadena (ver flujo rápido abajo).

IMPORTANTE: Cuando tienes nombre, tipo, ubicación, teléfono y objetivo → crea el plan. No sigas preguntando. Si necesitas un dato extra para un post específico (ej: una marca o un precio especial), pregúntalo justo antes de generar ESE post, no al inicio.

Formato de plan:
📋 **Plan: [Nombre]**
⏱ Duración: [X] días
📱 Canales: [plataformas]
**Acciones:**
1. [Acción] (Día X)
**Costo estimado:**
- [Servicio]: $X.XX
- **Total (orgánico): $X.XX**
- **Total (con ads): $X.XX** *(opcional)*
¿Desea aprobar este plan?

Costos de referencia (markup 500%):
- Texto: $0.01 | Imagen schnell: $0.015 | Imagen pro: $0.275
- Email: $0.005 | Publicación: incluido | Ads: según presupuesto

Horarios óptimos PR (America/Puerto_Rico, UTC-4):
- Lun-Vie: 12:00 PM o 7:00 PM
- Sáb-Dom: 10:00 AM o 1:00 PM

Límites de plataformas:
- Facebook: máximo 25 posts/día, mínimo 20 minutos entre posts. Si un plan tiene múltiples posts para el mismo día, programarlos con al menos 1 hora de separación.
- Si publish_post falla con "posting too fast", el sistema auto-reprograma para +30 minutos. Informa al cliente que el post fue reprogramado automáticamente.

=== REGLA CRÍTICA DE PUBLICACIÓN ===

⚠️ PROHIBICIÓN ABSOLUTA: NUNCA digas "publicado exitosamente" o confirmes una publicación sin haber llamado la tool publish_post.

Para publicar un post, DEBES seguir estos pasos EN ORDEN:
1. Llamar la tool publish_post con el contenido y plataformas
2. Esperar el resultado de la tool
3. SOLO si el resultado dice success:true, confirmar al cliente

Si el cliente dice "sí" o "publícalo", tu ÚNICA respuesta válida es LLAMAR la tool publish_post. NO generes texto de confirmación sin llamar la tool primero.

Esto aplica igual para "programado". No confirmes programación sin llamar publish_post.

=== EJECUCIÓN — FLUJO RÁPIDO (INVISIBLE MARKETING) ===

Cuando el cliente aprueba un plan o dice "publícalo/aprobado/dale", EJECUTA TODO EN CADENA sin parar a preguntar:

1. list_connected_accounts (verificar cuentas)
2. generate_content (crear texto — BREVE, ver reglas abajo)
3. generate_image (crear imagen por defecto — schnell $0.015, o carrusel si el contenido lo amerita)
4. publish_post (publicar inmediatamente o programar según el plan)
5. Mostrar SOLO el resultado final al cliente:
   - ✅ Texto usado (resumido)
   - 🖼️ Imagen(es) generada(s)
   - 📱 Plataforma y estado (publicado/programado)
   - 💰 Costo total
   - "¿Continuamos con el siguiente post del plan?"

Pioneer DECIDE como experto: tipo de post, estilo de imagen, aspect ratio, cantidad de imágenes, horario óptimo.
La aprobación del plan = autorización para ejecutar el primer post completo.
NO preguntes "¿quiere imagen?" — inclúyela por defecto (es lo profesional).
NO muestres el texto y esperes aprobación — genera, publica, y muestra el resultado.

REGLA DE CONTENIDO: Cuando llames publish_post, usa el texto EXACTO que devolvió generate_content. NO lo edites, NO le añadas comillas decorativas, NO le pongas formato propio. El texto ya sale listo para publicar.

EXCEPCIONES — solo pausar si el cliente lo pide explícitamente:
- "Quiero ver el texto antes de publicar" → generar texto, mostrar, esperar OK
- "Sin imagen" o "solo texto" → omitir generate_image
- "Quiero elegir las imágenes" → generar, mostrar, esperar selección
- "Quiero un carrusel de 5 fotos" → ajustar count según su pedido

Cada post requiere su propio turno. Solo puedes publicar 1 post por mensaje.
Si el plan tiene posts para días futuros, usar scheduled_for con la fecha del plan.
Para el siguiente post, espera un nuevo mensaje del cliente.

Frases que cuentan como aprobación: "Sí", "Aprobado", "Dale", "Perfecto", "Adelante", "Publícalo", "Ok, dale"
Frases ambiguas ("Se ve bien", "Interesante") → preguntar: "¿Desea que ejecute el plan?"

REGLA IMPORTANTE SOBRE IMÁGENES: Cuando ya generaste imágenes para un post, usa las MISMAS URLs. NO llames generate_image de nuevo. La URL de replicate.delivery sigue válida por 1 hora.

Cuando el cliente aprueba, tu respuesta DEBE incluir tool_use blocks para ejecutar. NO respondas solo con texto.

=== CONEXIÓN DE REDES SOCIALES (OAuth) ===

Tienes 2 tools para manejar la conexión de cuentas de redes sociales:

**Flujo para plataformas SIMPLES** (Twitter, TikTok, YouTube, Threads, Reddit):
1. Usa generate_connect_url → devuelve un authUrl
2. Muestra el enlace al cliente: "Abra este enlace para conectar su cuenta: [authUrl]"
3. El cliente autoriza → regresa al chat → la cuenta queda conectada automáticamente
4. Verificar con list_connected_accounts

**Flujo para plataformas HEADLESS** (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat):
Estas plataformas requieren un paso adicional de selección (página, organización, board, ubicación).

1. Usa generate_connect_url → devuelve authUrl (el modo headless se activa automáticamente)
2. Muestra el enlace al cliente
3. El cliente autoriza → regresa al chat → verás un mensaje automático: "Acabo de autorizar [plataforma]..."
4. Cuando veas ese mensaje, INMEDIATAMENTE llama get_pending_connection
5. get_pending_connection devuelve las opciones disponibles (páginas, organizaciones, etc.)
6. Muestra las opciones al cliente en una lista numerada
7. El cliente selecciona una opción (ej: "la número 1", "Mi Panadería")
8. Llama complete_connection con el selection_id de la opción elegida
9. Confirma la conexión al cliente

**LinkedIn tiene un caso especial:**
- get_pending_connection puede devolver _linkedin_data en la respuesta
- Cuando llames complete_connection para LinkedIn, DEBES incluir ese _linkedin_data tal cual
- Esto es porque el token de LinkedIn es de un solo uso y ya fue consumido al obtener opciones

**Bluesky** (sin OAuth): Pedir handle + App Password, usar generate_connect_url con esos datos.
**Telegram** (sin OAuth): Pedir bot token al cliente.

**Reglas de conexión:**
- Si el mensaje del cliente contiene "Acabo de autorizar" o "pending_connection", llama get_pending_connection INMEDIATAMENTE
- Los tokens de autorización expiran en 10 minutos — actúa rápido
- Si get_pending_connection dice "expired" o no hay conexión pendiente, pedir al cliente que intente conectar de nuevo
- NUNCA asumas que una cuenta está conectada — siempre verifica con list_connected_accounts

=== TOOLS ===

Tienes 7 herramientas:

1. **list_connected_accounts** — Verificar redes conectadas. Usar ANTES de proponer plan o publicar.
2. **generate_connect_url** — Generar enlace OAuth para conectar red social. Para plataformas headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat), el modo headless se activa automáticamente.
3. **generate_content** — Generar texto de post por plataforma. Usar después de aprobación del plan.
4. **generate_image** — Generar imagen AI (FLUX). Prompt en INGLÉS. Devuelve URL real (https://replicate.delivery/...). Incluir "no text overlay" en prompt.
5. **publish_post** — Publicar o programar post. DEBES llamar esta tool para publicar. NUNCA confirmes publicación sin haberla llamado.
6. **get_pending_connection** — Obtener opciones de selección para conexión headless (páginas de Facebook, organizaciones de LinkedIn, boards de Pinterest, ubicaciones de Google Business, perfiles de Snapchat). Llamar INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless.
7. **complete_connection** — Guardar la selección del cliente para completar una conexión headless. Llamar después de que el cliente elige una opción de get_pending_connection.

Sobre imágenes:
- Para incluir imagen en un post, PRIMERO llamar generate_image para obtener URL(s) real(es)
- Usar esas URLs reales en media_urls de publish_post
- Schnell es default ($0.015/img). Pro solo si el cliente pide mejor calidad ($0.275/img)
- Aspect ratio: Instagram 4:5, Facebook 1:1, Twitter 16:9, TikTok 9:16. Multi-plataforma: 1:1
- Las URLs expiran en 1 hora — publicar pronto después de generar
- Si el cliente quiere su propia foto: "La función de subir fotos estará disponible próximamente. Puedo generar una imagen AI o publicar solo con texto."
- Si el resultado de generate_image incluye _note_for_pioneer con "regenerated", informa al cliente que alguna imagen no fue accesible y se regeneró, con el costo total actualizado.
- NUNCA llames generate_image dos veces para el mismo post. Si ya generaste imágenes y el cliente las aprobó, usa esas mismas URLs en publish_post.

=== CARRUSELES / MULTI-IMAGEN ===

Como especialista de marketing, Pioneer decide cuántas imágenes son óptimas según el contenido:

Cuándo recomendar carrusel (2-10 imágenes):
- Catálogo/menú de productos: 3-6 imágenes (mostrar variedad)
- Tour del negocio/detrás de escenas: 3-5 imágenes (diferentes ángulos)
- Antes y después: 2 imágenes
- Showcase de servicios: 3-4 imágenes (un servicio por imagen)
- Evento o promoción especial: 3-5 imágenes (diferentes aspectos)
- Testimonios visuales: 2-3 imágenes

Cuándo usar imagen individual (1):
- Oferta de un solo producto: 1 imagen hero
- Post de branding simple: 1 imagen
- Anuncio directo/urgencia: 1 imagen impactante
- Post educativo: 1 imagen ilustrativa

Reglas de carrusel:
- Facebook soporta hasta 10 imágenes por post
- Instagram soporta hasta 10 imágenes (carrusel nativo)
- NO mezclar imágenes y video en el mismo post
- Usar el parámetro count en generate_image (no llamar múltiples veces)
- Informar al cliente el costo total: $0.015 × cantidad de imágenes
- Ejemplo: "Carrusel de 4 imágenes para mostrar su menú. Costo: $0.06"

=== TIPOS DE CONTENIDO Y REGLAS DE CALIDAD ===

8 tipos: oferta, educativo, testimonio, detrás de escenas, urgencia, CTA, branding, interactivo.

⚠️ REGLAS DE CONTENIDO — CRÍTICO:

BREVEDAD:
- Posts de Facebook/Instagram: máximo 4-6 líneas de texto + CTA + hashtags
- Fórmula: Hook (1 línea) + Beneficio/Info (2-3 líneas) + CTA con contacto real (1-2 líneas) + hashtags
- No escribas ensayos, pero incluye toda la info necesaria para que el cliente actúe
- Si hay muchos productos, DESTACAR 2-3 y decir "y más"

VERACIDAD — MÁS IMPORTANTE QUE BREVEDAD:
- NUNCA inventes testimonios, reseñas, o citas de clientes ficticios
- NUNCA inventes marcas, precios, o datos que el cliente no te haya dado
- NUNCA uses placeholders como [dirección] o [teléfono] — usa los datos REALES del cliente
- Si no tienes un dato necesario para el post, PREGUNTA antes de generar
- Para posts tipo testimonial: usa formato de beneficio/garantía sin citas inventadas, o pide al cliente un testimonio real

FORMATO:
- Español estilo PR (natural, no forzado)
- Emojis moderados (2-4 por post)
- Hashtags: 3-5 locales (#PR #PuertoRico #[pueblo]) + industria
- CTA claro con datos de contacto REALES en cada post
- Ejemplo BUENO: "🔧 ¿Tus gomas necesitan cambio? Servicio rápido y profesional con marcas Goodyear y Firestone.\n\n📍 Ave. Main #45, Bayamón\n📱 787-555-1234\n\n#MecánicoPR #GomasBayamón"
- Ejemplo MALO: "🔧 Tenemos las mejores marcas a los mejores precios. Visítanos en [dirección]. Llama al [teléfono]."

Reglas generales: CTA con teléfono/dirección real, hashtags locales + industria, nunca inventar datos.
`;
}

// === TOOLS DISPONIBLES PARA CLAUDE ===
const PIONEER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_connected_accounts',
    description:
      'Lista las cuentas de redes sociales conectadas del cliente. Úsala ANTES de proponer un plan o publicar, para saber en qué plataformas puede publicar.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'generate_connect_url',
    description:
      'Genera un enlace de autorización OAuth para conectar una red social. El cliente debe abrir este enlace en su navegador para autorizar la conexión. Para plataformas headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat), el modo headless se activa automáticamente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: [
            'facebook',
            'instagram',
            'twitter',
            'linkedin',
            'tiktok',
            'youtube',
            'pinterest',
            'reddit',
            'bluesky',
            'threads',
            'googlebusiness',
            'telegram',
            'snapchat',
          ],
          description: 'La plataforma de red social a conectar',
        },
        profile_id: {
          type: 'string',
          description:
            'El ID del perfil en Late.dev. Usar: 6984c371b984889d86a8b3d6',
        },
      },
      required: ['platform', 'profile_id'],
    },
  },
  {
    name: 'generate_content',
    description:
      'Genera el texto de un post para redes sociales, adaptado a cada plataforma. El texto debe ser BREVE (3-5 líneas + CTA + hashtags). Úsala después de que el cliente aprueba un plan de marketing, para crear el contenido antes de publicar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        business_name: {
          type: 'string',
          description: 'Nombre del negocio del cliente',
        },
        business_type: {
          type: 'string',
          description: 'Tipo de negocio (restaurante, tienda, salón, etc.)',
        },
        post_type: {
          type: 'string',
          enum: [
            'offer',
            'educational',
            'testimonial',
            'behind-scenes',
            'urgency',
            'cta',
            'branding',
            'interactive',
          ],
          description: 'Tipo de post a generar',
        },
        details: {
          type: 'string',
          description:
            'Detalles específicos del post (qué promocionar, qué tema, etc.)',
        },
        platforms: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'facebook',
              'instagram',
              'linkedin',
              'twitter',
              'tiktok',
              'youtube',
              'threads',
              'reddit',
              'pinterest',
              'bluesky',
              'googlebusiness',
              'telegram',
              'snapchat',
            ],
          },
          description: 'Plataformas para las que generar contenido',
        },
        tone: {
          type: 'string',
          enum: ['professional', 'casual', 'excited', 'informative', 'urgent'],
          description: 'Tono del contenido',
        },
        include_hashtags: {
          type: 'boolean',
          description: 'Si incluir hashtags relevantes para PR',
        },
      },
      required: [
        'business_name',
        'business_type',
        'post_type',
        'details',
        'platforms',
      ],
    },
  },
  {
    name: 'generate_image',
    description:
      'Genera una o más imágenes con inteligencia artificial (FLUX) para acompañar un post de redes sociales. Para carruseles/multi-imagen, usa count > 1 (máximo 10). Cada imagen usa el mismo prompt pero genera variaciones distintas. El prompt DEBE ser en inglés. Devuelve URLs reales (https://replicate.delivery/...) que se usan en media_urls de publish_post. Las URLs expiran en 1 hora — publicar pronto. NO llames esta tool si ya generaste imágenes para este post — reutiliza las URLs existentes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description:
            'Descripción de la imagen a generar. DEBE ser en inglés. Ejemplo: "professional photograph, fresh artisan bread on rustic wooden table, warm lighting, bakery, appetizing, no text overlay"',
        },
        model: {
          type: 'string',
          enum: ['schnell', 'pro'],
          description:
            'Modelo a usar. schnell = rápido y barato ($0.015/img), pro = mejor calidad ($0.275/img). Default: schnell.',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'],
          description:
            'Aspect ratio. Instagram: 4:5, Facebook: 1:1, Twitter: 16:9, TikTok: 9:16. Multi-plataforma: 1:1.',
        },
        count: {
          type: 'number',
          description:
            'Cantidad de imágenes a generar (1-10). Usar > 1 para carruseles. Cada imagen cuesta $0.015 (schnell). Default: 1.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'publish_post',
    description:
      'Publica o programa un post en las redes sociales del cliente. DEBES llamar esta tool para publicar — NUNCA confirmes una publicación sin haberla llamado. Puede publicar inmediatamente (publish_now: true) o programar para una fecha futura (scheduled_for). Usar URLs reales de replicate.delivery obtenidas de generate_image.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'El texto del post a publicar',
        },
        platforms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                enum: [
                  'facebook',
                  'instagram',
                  'linkedin',
                  'twitter',
                  'tiktok',
                  'youtube',
                  'threads',
                  'reddit',
                  'pinterest',
                  'bluesky',
                  'googlebusiness',
                  'telegram',
                  'snapchat',
                ],
              },
              account_id: {
                type: 'string',
                description: 'ID de la cuenta conectada en Late.dev',
              },
            },
            required: ['platform', 'account_id'],
          },
          description:
            'Lista de plataformas y sus account IDs donde publicar',
        },
        publish_now: {
          type: 'boolean',
          description:
            'Si es true, publica inmediatamente. Si es false, debe proporcionar scheduled_for.',
        },
        scheduled_for: {
          type: 'string',
          description:
            'Fecha y hora para programar la publicación en formato ISO 8601 (ej: 2026-02-06T12:00:00)',
        },
        timezone: {
          type: 'string',
          description: 'Zona horaria para la programación',
        },
        media_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'URLs de imágenes o videos a incluir en el post. Usar URLs reales de replicate.delivery obtenidas de generate_image.',
        },
      },
      required: ['content', 'platforms'],
    },
  },
  // === NUEVAS TOOLS: OAuth Headless ===
  {
    name: 'get_pending_connection',
    description:
      'Obtiene las opciones de selección para completar una conexión de red social headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat). Llámala INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless (verás un mensaje como "Acabo de autorizar [plataforma]. Necesito completar la conexión."). Devuelve las páginas, organizaciones, boards, ubicaciones o perfiles disponibles para que el cliente elija.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'complete_connection',
    description:
      'Completa una conexión headless guardando la selección del cliente (la página, organización, board, ubicación o perfil que eligió). Llámala después de que el cliente selecciona una opción de las devueltas por get_pending_connection. Para LinkedIn, DEBES incluir _linkedin_data si fue devuelto por get_pending_connection.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['facebook', 'instagram', 'linkedin', 'pinterest', 'googlebusiness', 'snapchat'],
          description: 'La plataforma para la que se completa la conexión',
        },
        selection_id: {
          type: 'string',
          description: 'El ID de la opción seleccionada por el cliente (page ID, organization ID, board ID, location ID, o profile ID)',
        },
        selection_name: {
          type: 'string',
          description: 'El nombre de la opción seleccionada (para confirmación al cliente)',
        },
        _linkedin_data: {
          type: 'object',
          description: 'Datos de LinkedIn devueltos por get_pending_connection. OBLIGATORIO para LinkedIn porque el token es de un solo uso.',
          properties: {
            tempToken: { type: 'string' },
            userProfile: { type: 'object' },
            organizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  urn: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
      required: ['platform', 'selection_id'],
    },
  },
];

// === LIMPIAR MARKDOWN Y FORMATO PARA REDES SOCIALES ===
// Facebook, Instagram, etc. no renderizan markdown — los ** se muestran como asteriscos
// También limpia comillas decorativas que Claude añade alrededor de "testimonios"
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')   // ***bold italic*** → text
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold** → text
    .replace(/\*(.*?)\*/g, '$1')            // *italic* → text
    .replace(/~~(.*?)~~/g, '$1')            // ~~strikethrough~~ → text
    .replace(/`(.*?)`/g, '$1')              // `code` → text
    .replace(/^#{1,6}\s+/gm, '')            // ### headers → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) → link text
    .replace(/^"|"$/gm, '')                 // Comillas decorativas al inicio/fin de línea
    .replace(/[""]/g, '"')                  // Comillas tipográficas → rectas
    .replace(/['']/g, "'")                  // Apóstrofes tipográficos → rectos
    .replace(/\\"/g, '"');                  // Comillas escapadas \"...\" → "..."
}

// === VALIDACIÓN PREVENTIVA PARA PUBLISH_POST ===

interface ValidatedPublishData {
  content: string;
  platforms: LatePlatformTarget[];
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}

interface ValidationResult {
  success: boolean;
  data?: ValidatedPublishData;
  error?: string;
  corrections?: string[];
}

async function validateAndPreparePublish(
  input: {
    content: string;
    platforms: Array<{ platform: string; account_id: string }>;
    publish_now?: boolean;
    scheduled_for?: string;
    timezone?: string;
    media_urls?: string[];
  },
  generateImageWasCalled: boolean
): Promise<ValidationResult> {
  const corrections: string[] = [];

  // --- 0. Validar media_urls vs generate_image tracking ---
  if (input.media_urls?.length && !generateImageWasCalled) {
    const allFromReplicate = input.media_urls.every(url =>
      url.startsWith('https://replicate.delivery/')
    );
    if (!allFromReplicate) {
      return {
        success: false,
        error: 'ERROR: Se incluyeron media_urls con URLs no válidas. Las URLs de imágenes deben ser de replicate.delivery (obtenidas via generate_image). Llama la tool generate_image PRIMERO para obtener una URL real.',
        corrections: ['media_urls rechazadas: URLs no son de replicate.delivery y generate_image no fue llamada en esta sesión'],
      };
    }
    corrections.push('media_urls de replicate.delivery aceptadas de request anterior (generate_image no fue llamada en este request)');
  }

  // --- 1. Limpiar markdown del contenido ---
  const cleanContent = stripMarkdown(input.content);

  // --- 2. Obtener cuentas reales de Late.dev ---
  let realAccounts: Array<{ _id: string; platform: string; username?: string }>;
  try {
    const accountsResult = await listAccounts();
    realAccounts = accountsResult.accounts;
  } catch (error) {
    return {
      success: false,
      error: `No se pudieron verificar las cuentas conectadas: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    };
  }

  if (realAccounts.length === 0) {
    return {
      success: false,
      error: 'No hay cuentas de redes sociales conectadas. El cliente debe conectar al menos una cuenta antes de publicar.',
    };
  }

  // --- 3. Validar y auto-corregir cada account_id ---
  const validatedPlatforms: LatePlatformTarget[] = [];

  for (const requested of input.platforms) {
    const platform = requested.platform as Platform;

    const exactMatch = realAccounts.find(
      (acc) => acc._id === requested.account_id && acc.platform === platform
    );

    if (exactMatch) {
      validatedPlatforms.push({
        platform,
        accountId: exactMatch._id,
      });
      continue;
    }

    const platformMatch = realAccounts.find(
      (acc) => acc.platform === platform
    );

    if (platformMatch) {
      corrections.push(
        `account_id para ${platform} corregido: ${requested.account_id} → ${platformMatch._id} (${platformMatch.username || 'sin username'})`
      );
      validatedPlatforms.push({
        platform,
        accountId: platformMatch._id,
      });
      continue;
    }

    corrections.push(
      `No hay cuenta conectada para ${platform} — omitida de la publicación`
    );
  }

  if (validatedPlatforms.length === 0) {
    return {
      success: false,
      error: 'Ninguna de las plataformas solicitadas tiene una cuenta conectada. El cliente debe conectar sus redes sociales primero.',
      corrections,
    };
  }

  // --- 4. Validar límite de caracteres por plataforma ---
  for (const vp of validatedPlatforms) {
    const charLimit = PLATFORM_CHAR_LIMITS[vp.platform];
    if (charLimit && cleanContent.length > charLimit) {
      corrections.push(
        `Contenido excede límite de ${vp.platform} (${cleanContent.length}/${charLimit} chars) — truncado`
      );
    }
  }

  let finalContent = cleanContent;
  const minCharLimit = Math.min(
    ...validatedPlatforms.map((vp) => PLATFORM_CHAR_LIMITS[vp.platform] || Infinity)
  );
  if (finalContent.length > minCharLimit) {
    finalContent = finalContent.substring(0, minCharLimit - 3) + '...';
  }

  // --- 5. Validar media_urls — SOLO permitir http:// y https:// ---
  const validMediaUrls: string[] = [];
  if (input.media_urls?.length) {
    for (const url of input.media_urls) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        validMediaUrls.push(url);
      } else {
        corrections.push(
          `URL de media inválida descartada (protocolo no soportado): ${url.substring(0, 80)}...`
        );
      }
    }
  }

  // --- 6. Construir datos de publicación ---
  const publishData: ValidatedPublishData = {
    content: finalContent,
    platforms: validatedPlatforms,
  };

  if (input.publish_now) {
    publishData.publishNow = true;
  } else if (input.scheduled_for) {
    publishData.scheduledFor = input.scheduled_for;
    publishData.timezone = input.timezone || PR_TIMEZONE;
  } else {
    publishData.scheduledFor = getNextOptimalTime();
    publishData.timezone = PR_TIMEZONE;
  }

  if (validMediaUrls.length > 0) {
    publishData.mediaItems = validMediaUrls.map((url) => ({
      type: (url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image') as 'image' | 'video',
      url,
    }));
  }

  return {
    success: true,
    data: publishData,
    corrections,
  };
}

// === RETRY INTELIGENTE ===

// Detectar si el error es "posting too fast" de Facebook/plataforma
function isPostingTooFast(error: unknown): boolean {
  if (error instanceof LateApiError) {
    const bodyLower = error.body.toLowerCase();
    return bodyLower.includes('posting too fast') || bodyLower.includes('rate limit');
  }
  return false;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof LateApiError) {
    if (error.status >= 500) {
      const clearErrors = ['invalid', 'not found', 'unauthorized', 'forbidden'];
      const bodyLower = error.body.toLowerCase();
      return !clearErrors.some((msg) => bodyLower.includes(msg));
    }
    if (error.status === 429) return true;
    return false;
  }
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  return false;
}

// Calcula una fecha +30 minutos desde ahora en PR timezone
function getScheduleIn30Min(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  return now.toISOString().replace(/\.\d{3}Z$/, '');
}

async function publishWithRetry(
  data: ValidatedPublishData
): Promise<{ message: string; post: unknown; autoRescheduled?: boolean; rescheduledFor?: string }> {
  try {
    const result = await createPost(data);
    return result;
  } catch (firstError) {
    console.error('[Pioneer] Primer intento de publicación falló:', firstError);

    // === AUTO-REPROGRAMAR si "posting too fast" ===
    if (isPostingTooFast(firstError)) {
      console.log('[Pioneer] "Posting too fast" detectado. Auto-reprogramando para +30 minutos...');
      const rescheduleTime = getScheduleIn30Min();
      const rescheduledData: ValidatedPublishData = {
        ...data,
        publishNow: false,
        scheduledFor: rescheduleTime,
        timezone: PR_TIMEZONE,
      };
      try {
        const result = await createPost(rescheduledData);
        return {
          ...result,
          autoRescheduled: true,
          rescheduledFor: rescheduleTime,
        };
      } catch (rescheduleError) {
        console.error('[Pioneer] Auto-reprogramación también falló:', rescheduleError);
        throw rescheduleError;
      }
    }

    if (!isTransientError(firstError)) {
      throw firstError;
    }

    console.log('[Pioneer] Error transitorio detectado. Reintentando (1/1)...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      return await createPost(data);
    } catch (retryError) {
      console.error('[Pioneer] Retry falló:', retryError);
      throw retryError;
    }
  }
}

// === EJECUTAR TOOLS — LLAMADAS DIRECTAS (sin fetch HTTP) ===

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  generateImageWasCalled: boolean,
  publishPostCount: number,
  hallucinationRetryUsed: boolean,
  lastGeneratedImageUrls: string[],
  // OAuth headless context
  pendingOAuthData: OAuthPendingData | null,
  linkedInCachedData: Record<string, unknown> | null,
  cachedConnectionOptions: Array<{ id: string; name: string }> | null
): Promise<{
  result: string;
  publishPostCalled: boolean;
  shouldClearOAuthCookie: boolean;
  linkedInDataToCache: Record<string, unknown> | null;
  connectionOptionsToCache: Array<{ id: string; name: string }> | null;
}> {
  try {
    switch (toolName) {
      case 'list_connected_accounts': {
        const result = await listAccounts();
        return {
          result: JSON.stringify({
            success: true,
            accounts: result.accounts,
            count: result.accounts.length,
          }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_connect_url': {
        const input = toolInput as {
          platform: string;
          profile_id: string;
        };
        const result = await getConnectUrl(
          input.platform as Platform,
          input.profile_id
        );

        // Informar a Pioneer si es headless para que sepa esperar
        const headless = isHeadlessPlatform(input.platform);

        return {
          result: JSON.stringify({
            success: true,
            authUrl: result.authUrl,
            platform: input.platform,
            headless,
            ...(headless && {
              _note_for_pioneer: `Esta plataforma (${input.platform}) usa modo headless. Después de que el cliente autorice, regresará al chat con un mensaje automático. En ese momento debes llamar get_pending_connection para obtener las opciones de selección.`,
            }),
          }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_content': {
        const input = toolInput as {
          business_name: string;
          business_type: string;
          post_type: string;
          details: string;
          platforms: string[];
          tone?: string;
          include_hashtags?: boolean;
        };
        const result = await generateContent({
          business_name: input.business_name,
          business_type: input.business_type,
          post_type: input.post_type,
          details: input.details,
          platforms: input.platforms,
          tone: input.tone || 'professional',
          include_hashtags: input.include_hashtags !== false,
        });
        return {
          result: JSON.stringify(result),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_image': {
        // === FIX BUG 8.1: Bloquear regeneración en retry de alucinación ===
        if (hallucinationRetryUsed && lastGeneratedImageUrls.length > 0) {
          console.log(`[Pioneer] Reutilizando ${lastGeneratedImageUrls.length} imagen(es) existente(s) en retry de alucinación`);
          return {
            result: JSON.stringify({
              success: true,
              images: lastGeneratedImageUrls,
              model: 'cached',
              cost_real: 0,
              cost_client: 0,
              expires_in: '1 hora',
              regenerated: false,
              attempts: 0,
              _note: 'Imagen(es) reutilizada(s) del intento anterior (no se generaron nuevas)',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const input = toolInput as {
          prompt: string;
          model?: string;
          aspect_ratio?: string;
          count?: number;
        };

        const imageCount = input.count && input.count > 1 ? Math.min(input.count, 10) : 0;

        // === CARRUSEL: Generación secuencial con delay ===
        if (imageCount > 1) {
          console.log(`[Pioneer] Generando carrusel de ${imageCount} imágenes (secuencial, 10s delay)`);

          const allImages: string[] = [];
          let totalCostReal = 0;
          let totalCostClient = 0;
          let anyRegenerated = false;
          const errors: string[] = [];

          for (let i = 0; i < imageCount; i++) {
            try {
              // Delay entre imágenes (excepto la primera)
              if (i > 0) {
                console.log(`[Pioneer] Esperando 10s antes de imagen ${i + 1}/${imageCount}...`);
                await new Promise((resolve) => setTimeout(resolve, 10000));
              }

              console.log(`[Pioneer] Generando imagen ${i + 1}/${imageCount}...`);
              const result = await generateImage({
                prompt: input.prompt,
                model: (input.model as 'schnell' | 'pro') || 'schnell',
                aspect_ratio: (input.aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1',
                num_outputs: 1,
              });

              if (result.success && result.images && result.images.length > 0) {
                allImages.push(...result.images);
                totalCostReal += result.cost_real;
                totalCostClient += result.cost_client;
                if (result.regenerated) anyRegenerated = true;
              } else {
                errors.push(`Imagen ${i + 1}: ${result.error || 'Error desconocido'}`);
              }
            } catch (imgError) {
              console.error(`[Pioneer] Error en imagen ${i + 1}:`, imgError);
              errors.push(`Imagen ${i + 1}: ${imgError instanceof Error ? imgError.message : 'Error desconocido'}`);
            }
          }

          const resultObj: Record<string, unknown> = {
            success: allImages.length > 0,
            images: allImages,
            model: input.model || 'schnell',
            cost_real: totalCostReal,
            cost_client: totalCostClient,
            expires_in: '1 hora',
            total_requested: imageCount,
            total_generated: allImages.length,
            ...(errors.length > 0 && { errors }),
          };

          if (allImages.length < imageCount && allImages.length > 0) {
            resultObj._note_for_pioneer = `Solo se generaron ${allImages.length} de ${imageCount} imágenes solicitadas. Costo total: $${totalCostClient.toFixed(3)}. Informa al cliente.`;
          }
          if (anyRegenerated) {
            resultObj._note_for_pioneer = `Algunas imágenes necesitaron regeneración. Costo total: $${totalCostClient.toFixed(3)} (${imageCount} imágenes). Informa al cliente del costo actualizado.`;
          }
          if (errors.length > 0 && allImages.length === 0) {
            resultObj.error = errors[0];
          }

          return {
            result: JSON.stringify(resultObj),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        // Imagen individual (flujo original)
        const result = await generateImage({
          prompt: input.prompt,
          model: (input.model as 'schnell' | 'pro') || 'schnell',
          aspect_ratio: (input.aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1',
          num_outputs: 1,
        });

        // === NOTA PARA PIONEER: informar al cliente si hubo regeneración ===
        const resultObj: Record<string, unknown> = { ...result };
        if (result.regenerated && result.success) {
          resultObj._note_for_pioneer = `IMPORTANTE: La primera imagen generada no fue accesible y se regeneró automáticamente. El costo total de imagen fue $${result.cost_client.toFixed(3)} (${result.attempts} intentos). Informa al cliente de este costo actualizado.`;
        }

        return {
          result: JSON.stringify(resultObj),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'publish_post': {
        // === LÍMITE: MÁXIMO 1 publish_post POR REQUEST ===
        if (publishPostCount >= 1) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'Solo puedes publicar 1 post por mensaje. Para publicar el siguiente post, espera a que el cliente envíe un nuevo mensaje confirmando que desea continuar.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const input = toolInput as {
          content: string;
          platforms: Array<{ platform: string; account_id: string }>;
          publish_now?: boolean;
          scheduled_for?: string;
          timezone?: string;
          media_urls?: string[];
        };

        // === FIX BUG 8.1b: Inyectar imágenes automáticamente en retry de alucinación ===
        if (hallucinationRetryUsed && lastGeneratedImageUrls.length > 0 && (!input.media_urls || input.media_urls.length === 0)) {
          console.log(`[Pioneer] Inyectando ${lastGeneratedImageUrls.length} imagen(es) guardada(s) en publish_post durante retry`);
          input.media_urls = lastGeneratedImageUrls;
        }

        // === NIVEL 1: VALIDACIÓN PREVENTIVA ===
        const validation = await validateAndPreparePublish(input, generateImageWasCalled);

        if (!validation.success || !validation.data) {
          return {
            result: JSON.stringify({
              success: false,
              error: validation.error,
              corrections: validation.corrections,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        if (validation.corrections && validation.corrections.length > 0) {
          console.log('[Pioneer] Correcciones preventivas:', validation.corrections);
        }

        // === NIVEL 2: PUBLICAR CON RETRY INTELIGENTE ===
        try {
          const result = await publishWithRetry(validation.data);

          const imageIncluded = !!(validation.data.mediaItems && validation.data.mediaItems.length > 0);

          // Detectar si fue auto-reprogramado por "posting too fast"
          const wasAutoRescheduled = 'autoRescheduled' in result && result.autoRescheduled;
          const rescheduledFor = 'rescheduledFor' in result ? result.rescheduledFor : undefined;

          let successMessage: string;
          if (wasAutoRescheduled && rescheduledFor) {
            successMessage = `La plataforma indicó "posting too fast". El post fue auto-reprogramado para ${rescheduledFor} (en ~30 minutos). No se requiere acción del cliente.`;
          } else if (validation.data.publishNow) {
            successMessage = 'Post publicado exitosamente';
          } else {
            successMessage = `Post programado para ${validation.data.scheduledFor}`;
          }

          return {
            result: JSON.stringify({
              success: true,
              message: successMessage,
              post: result.post,
              image_included: imageIncluded,
              ...(wasAutoRescheduled && {
                auto_rescheduled: true,
                rescheduled_for: rescheduledFor,
              }),
              ...(validation.data.scheduledFor && !wasAutoRescheduled && {
                scheduledFor: validation.data.scheduledFor,
                timezone: validation.data.timezone,
              }),
              ...(validation.corrections &&
                validation.corrections.length > 0 && {
                  _corrections: validation.corrections,
                }),
            }),
            publishPostCalled: true,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        } catch (publishError) {
          console.error('[Pioneer] Publicación falló después de validación y retry:', publishError);

          const errorMessage =
            publishError instanceof LateApiError
              ? `Error de Late.dev (HTTP ${publishError.status}): ${publishError.body}`
              : publishError instanceof Error
                ? publishError.message
                : 'Error desconocido al publicar';

          return {
            result: JSON.stringify({
              success: false,
              error: errorMessage,
              corrections: validation.corrections,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }
      }

      // ============================================================
      // === NUEVAS TOOLS: OAuth Headless ===
      // ============================================================

      case 'get_pending_connection': {
        // Leer cookie OAuth pendiente
        const pending = pendingOAuthData;

        if (!pending) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'No hay conexión pendiente. La sesión de autorización pudo haber expirado (10 minutos). El cliente debe intentar conectar la plataforma de nuevo usando generate_connect_url.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const { platform, step, profileId, tempToken, connectToken, pendingDataToken } = pending;

        console.log(`[Pioneer] get_pending_connection: ${platform} (step: ${step})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener páginas de Facebook. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const fbResult = await getFacebookPages(profileId, tempToken, connectToken);
              const fbOptions = fbResult.pages.map(p => ({
                id: p.id,
                name: p.name,
                username: p.username || '',
                category: p.category || '',
              }));
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'pages',
                  options: fbOptions,
                  message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente para que elija una. IMPORTANTE: Cuando llame complete_connection, use EXACTAMENTE el "id" de la opción seleccionada.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: fbOptions.map(o => ({ id: o.id, name: o.name })),
              };
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                // Sin pendingDataToken = se conectó directamente como personal
                return {
                  result: JSON.stringify({
                    success: true,
                    platform,
                    step: 'direct_connect',
                    options_type: 'none',
                    options: [],
                    message: 'La cuenta de LinkedIn se conectó directamente como cuenta personal (sin organizaciones disponibles). La conexión está completa.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: true,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              const linkedInData = await getLinkedInPendingData(pendingDataToken);

              if (!linkedInData.organizations || linkedInData.organizations.length === 0) {
                // No tiene organizaciones → conectar como personal automáticamente
                if (connectToken) {
                  await saveLinkedInOrganization(
                    profileId,
                    linkedInData.tempToken,
                    linkedInData.userProfile as Record<string, unknown>,
                    'personal',
                    connectToken
                  );
                }
                return {
                  result: JSON.stringify({
                    success: true,
                    platform,
                    step: 'auto_connected',
                    options_type: 'none',
                    options: [],
                    message: `LinkedIn conectado como cuenta personal de ${linkedInData.userProfile.displayName}. No se encontraron organizaciones.`,
                    connected: true,
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: true,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              // Tiene organizaciones → mostrar opciones al cliente
              const liOptions = [
                { id: 'personal', name: `Cuenta personal (${linkedInData.userProfile.displayName})` },
                ...linkedInData.organizations.map(o => ({ id: o.id, name: o.name })),
              ];

              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'organizations',
                  options: liOptions,
                  message: `Se encontraron ${linkedInData.organizations.length} organización(es) de LinkedIn, más la opción de cuenta personal. IMPORTANTE: Cuando llame complete_connection, DEBE incluir _linkedin_data tal cual se devuelve aquí.`,
                  _linkedin_data: {
                    tempToken: linkedInData.tempToken,
                    userProfile: linkedInData.userProfile,
                    organizations: linkedInData.organizations,
                  },
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: {
                  tempToken: linkedInData.tempToken,
                  userProfile: linkedInData.userProfile,
                  organizations: linkedInData.organizations,
                },
                connectionOptionsToCache: liOptions,
              };
            }

            case 'pinterest': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener boards de Pinterest. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const pinResult = await getPinterestBoards(profileId, tempToken, connectToken);
              const pinOptions = pinResult.boards.map(b => ({
                id: b.id,
                name: b.name,
              }));
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'boards',
                  options: pinOptions,
                  message: `Se encontraron ${pinResult.boards.length} board(s) de Pinterest.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: pinOptions,
              };
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener ubicaciones de Google Business. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const gbResult = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
              const gbOptions = gbResult.locations.map(l => ({
                id: l.id,
                name: l.name,
              }));
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'locations',
                  options: gbOptions,
                  message: `Se encontraron ${gbResult.locations.length} ubicación(es) de Google Business.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: gbOptions,
              };
            }

            case 'snapchat': {
              // Snapchat: guardar perfil público directamente
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para Snapchat. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'profiles',
                  options: [{ id: 'public_profile', name: 'Perfil público de Snapchat' }],
                  message: 'Snapchat requiere seleccionar el perfil público para completar la conexión.',
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: [{ id: 'public_profile', name: 'Perfil público de Snapchat' }],
              };
            }

            default:
              return {
                result: JSON.stringify({
                  success: false,
                  error: `Plataforma no soportada para conexión headless: ${platform}`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
          }
        } catch (error) {
          console.error(`[Pioneer] Error obteniendo opciones para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return {
              result: JSON.stringify({
                success: false,
                error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
                expired: true,
              }),
              publishPostCalled: false,
              shouldClearOAuthCookie: true,
              linkedInDataToCache: null,
              connectionOptionsToCache: null,
            };
          }

          throw error;
        }
      }

      case 'complete_connection': {
        const input = toolInput as {
          platform: string;
          selection_id: string;
          selection_name?: string;
          _linkedin_data?: {
            tempToken: string;
            userProfile: Record<string, unknown>;
            organizations: Array<{ id: string; urn: string; name: string }>;
          };
        };

        const pending = pendingOAuthData;

        if (!pending) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const { platform, profileId, tempToken, connectToken, userProfile } = pending;
        const { selection_id, selection_name } = input;

        console.log(`[Pioneer] complete_connection: ${platform}, selection: ${selection_id} (${selection_name})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la selección de Facebook. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              // === BUG 8.5 FIX: Re-fetch pages para validar selection_id ===
              let validatedSelectionId = selection_id;
              try {
                const fbPages = await getFacebookPages(profileId, tempToken, connectToken);
                const realPages = fbPages.pages;

                const exactMatch = realPages.find(p => p.id === selection_id);
                if (!exactMatch) {
                  console.warn(`[Pioneer] ⚠️ selection_id "${selection_id}" no coincide con ninguna page real. Intentando auto-corrección...`);

                  // Intentar match por nombre
                  if (selection_name) {
                    const nameMatch = realPages.find(p =>
                      p.name.toLowerCase() === selection_name.toLowerCase()
                    );
                    if (nameMatch) {
                      console.log(`[Pioneer] ⚠️ CORRECCIÓN FB: ID "${selection_id}" → "${nameMatch.id}" (match por nombre: "${nameMatch.name}")`);
                      validatedSelectionId = nameMatch.id;
                    }
                  }

                  // Si solo hay 1 page, usar esa
                  if (validatedSelectionId === selection_id && realPages.length === 1) {
                    console.log(`[Pioneer] ⚠️ CORRECCIÓN FB: ID "${selection_id}" → "${realPages[0].id}" (única page disponible: "${realPages[0].name}")`);
                    validatedSelectionId = realPages[0].id;
                  }

                  if (validatedSelectionId === selection_id) {
                    console.warn(`[Pioneer] ⚠️ No se pudo auto-corregir. Intentando con ID original. Pages: ${JSON.stringify(realPages.map(p => ({ id: p.id, name: p.name })))}`);
                  }
                }
              } catch (fetchErr) {
                console.warn('[Pioneer] No se pudieron re-fetch pages para validación:', fetchErr);
              }

              await saveFacebookPage(profileId, validatedSelectionId, tempToken, userProfile, connectToken);
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'linkedin': {
              // LinkedIn: usar _linkedin_data del input O del cache
              const liData = input._linkedin_data || (linkedInCachedData as {
                tempToken: string;
                userProfile: Record<string, unknown>;
                organizations: Array<{ id: string; urn: string; name: string }>;
              } | null);

              if (!liData || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos de LinkedIn para guardar la selección. Asegúrate de incluir _linkedin_data que devolvió get_pending_connection. El cliente puede necesitar intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              const isPersonal = selection_id === 'personal';
              const selectedOrg = isPersonal
                ? undefined
                : liData.organizations.find(o => o.id === selection_id);

              await saveLinkedInOrganization(
                profileId,
                liData.tempToken,
                liData.userProfile,
                isPersonal ? 'personal' : 'organization',
                connectToken,
                selectedOrg
              );

              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: isPersonal
                    ? `LinkedIn conectado como cuenta personal de ${liData.userProfile.displayName || 'usuario'}.`
                    : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'pinterest': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la selección de Pinterest. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await savePinterestBoard(
                profileId,
                selection_id,
                selection_name || selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la ubicación de Google Business. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await saveGoogleBusinessLocation(
                profileId,
                selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'snapchat': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar el perfil de Snapchat. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await saveSnapchatProfile(
                profileId,
                selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Perfil público de Snapchat conectado exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            default:
              return {
                result: JSON.stringify({
                  success: false,
                  error: `Plataforma no soportada para completar conexión: ${platform}`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
          }
        } catch (error) {
          console.error(`[Pioneer] Error completando conexión para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return {
              result: JSON.stringify({
                success: false,
                error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
                expired: true,
              }),
              publishPostCalled: false,
              shouldClearOAuthCookie: true,
              linkedInDataToCache: null,
              connectionOptionsToCache: null,
            };
          }

          throw error;
        }
      }

      default:
        return {
          result: JSON.stringify({
            error: `Tool desconocida: ${toolName}`,
          }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
    }
  } catch (error) {
    console.error(`[Pioneer] Error ejecutando tool ${toolName}:`, error);
    return {
      result: JSON.stringify({
        success: false,
        error: `Error ejecutando ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      }),
      publishPostCalled: false,
      shouldClearOAuthCookie: false,
      linkedInDataToCache: null,
      connectionOptionsToCache: null,
    };
  }
}

// === MÁXIMO DE ITERACIONES DEL LOOP DE TOOL_USE ===
const MAX_TOOL_USE_ITERATIONS = 10;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Se requiere un array de mensajes' },
        { status: 400 }
      );
    }

    // Formatear mensajes para Claude API
    const formattedMessages: Anthropic.MessageParam[] = messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })
    );

    // === LEER COOKIE OAUTH AL INICIO DEL REQUEST ===
    // Usamos getOAuthCookie(request) que lee directamente de NextRequest.cookies
    // Más confiable que cookies() de next/headers en Route Handlers
    let pendingOAuthData: OAuthPendingData | null = null;
    try {
      // Log all cookies for debugging
      const allCookies = request.cookies.getAll();
      console.log(`[Pioneer] Cookies en request (${allCookies.length}):`, allCookies.map(c => c.name));
      
      pendingOAuthData = getOAuthCookie(request);
      console.log(`[Pioneer] OAuth cookie leída:`, pendingOAuthData ? 
        `platform=${pendingOAuthData.platform}, step=${pendingOAuthData.step}` : 'null');
    } catch (error) {
      console.warn('[Pioneer] No se pudo leer OAuth cookie:', error);
    }

    // === LOOP DE TOOL_USE ===
    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];

    // === TRACKING ===
    let generateImageWasCalled = false;
    let lastGeneratedImageUrls: string[] = [];
    let publishPostCount = 0;
    let hallucinationRetryUsed = false;
    let shouldClearOAuthCookie = false;
    let linkedInCachedData: Record<string, unknown> | null = null;
    let cachedConnectionOptions: Array<{ id: string; name: string }> | null = null;

    // Generar system prompt con fecha actual
    const systemPrompt = buildSystemPrompt();

    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        tools: PIONEER_TOOLS,
        messages: currentMessages,
      });

      // Recoger texto de esta iteración
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlocks.length > 0) {
        finalTextParts.push(...textBlocks.map((b) => b.text));
      }

      // Si Claude terminó, verificar antes de devolver
      if (response.stop_reason === 'end_turn') {
        const fullText = finalTextParts.join('\n\n');

        // === DETECCIÓN DE ALUCINACIÓN DE PUBLICACIÓN ===
        if (detectPublishHallucination(fullText, publishPostCount) && !hallucinationRetryUsed) {
          console.warn('[Pioneer] ⚠️ ALUCINACIÓN DETECTADA: Claude dijo "publicado" sin llamar publish_post. Forzando retry.');
          hallucinationRetryUsed = true;

          let correctiveMessage = 'ERROR DEL SISTEMA: No se ejecutó la publicación. Debes llamar la tool publish_post para publicar el post. El cliente ya aprobó. Llama publish_post ahora con el contenido que generaste anteriormente. NO respondas con texto — usa la tool publish_post.';

          if (lastGeneratedImageUrls.length > 0) {
            correctiveMessage += ` IMPORTANTE: NO generes nuevas imágenes. Usa estas URLs que ya generaste: ${JSON.stringify(lastGeneratedImageUrls)}`;
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            {
              role: 'user' as const,
              content: correctiveMessage,
            },
          ];

          finalTextParts = [];
          continue;
        }

        // === Construir respuesta con cookie clearing si necesario ===
        const jsonResponse = NextResponse.json({
          message: fullText,
          usage: response.usage,
        });

        if (shouldClearOAuthCookie) {
          jsonResponse.cookies.set(COOKIE_NAME, '', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
          });
        }

        return jsonResponse;
      }

      // Si Claude quiere usar tools, procesarlas
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          return NextResponse.json({
            message:
              finalTextParts.join('\n\n') ||
              'Error interno: tool_use sin herramientas.',
          });
        }

        // Procesar cada tool_use block
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          console.log(
            `[Pioneer] Ejecutando tool: ${toolBlock.name}`,
            JSON.stringify(toolBlock.input).substring(0, 200)
          );

          const toolResult = await executeTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>,
            generateImageWasCalled,
            publishPostCount,
            hallucinationRetryUsed,
            lastGeneratedImageUrls,
            pendingOAuthData,
            linkedInCachedData,
            cachedConnectionOptions
          );

          // Actualizar tracking
          if (toolBlock.name === 'generate_image') {
            generateImageWasCalled = true;
            try {
              const imgResult = JSON.parse(toolResult.result);
              if (imgResult.success && imgResult.images) {
                lastGeneratedImageUrls = imgResult.images;
              } else if (imgResult.success && imgResult.image_url) {
                lastGeneratedImageUrls = [imgResult.image_url];
              }
            } catch {
              // No-op: si no se puede parsear, mantener tracking anterior
            }
          }

          if (toolResult.publishPostCalled) {
            publishPostCount += 1;
          }

          if (toolResult.shouldClearOAuthCookie) {
            shouldClearOAuthCookie = true;
          }

          if (toolResult.linkedInDataToCache) {
            linkedInCachedData = toolResult.linkedInDataToCache;
          }

          if (toolResult.connectionOptionsToCache) {
            cachedConnectionOptions = toolResult.connectionOptionsToCache;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult.result,
          });
        }

        // Agregar respuesta de Claude + tool_results a messages
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          {
            role: 'user' as const,
            content: toolResults,
          },
        ];
      }
    }

    // Si llegamos aquí, agotamos las iteraciones
    return NextResponse.json({
      message:
        finalTextParts.join('\n\n') ||
        'Lo siento, la operación tomó demasiados pasos. Por favor intente de nuevo con una solicitud más simple.',
    });
  } catch (error) {
    console.error('[Pioneer] Error en POST /api/chat:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        {
          error: `Error de Claude API: ${error.message}`,
          status: error.status,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
