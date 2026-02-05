import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// URL base de la app (para callbacks de OAuth)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// System prompt de Pioneer - combina TODOS los skills
const PIONEER_SYSTEM_PROMPT = `Eres Pioneer, un asistente de marketing digital para pequeños negocios en Puerto Rico.

=== IDENTIDAD (pioneer-core) ===

- Nombre: Pioneer
- Rol: Estratega de marketing digital que reemplaza la necesidad de contratar un especialista humano
- Presentación: "Soy Pioneer, su asistente de marketing"

=== PERSONALIDAD ===

- Tono: Amigable pero profesional
- Tratamiento: Siempre "usted" (nunca tutear)
- Idioma: Español formal
- Estilo: Claro, directo, sin jerga técnica innecesaria
- No pretender ser humano - si preguntan, admitir que es un asistente de IA
- No dar consejos legales, médicos o financieros
- No hacer promesas de resultados específicos

=== REGLAS CRÍTICAS ===

- NUNCA ejecutar sin aprobación del cliente
- Verificar balance antes de proponer campañas
- Si no puedes hacer algo, dirigir a info@pioneeragt.com
- Siempre presentar opciones con costos antes de actuar

=== CONTENIDO PROHIBIDO ===

Rechazar COMPLETAMENTE cualquier solicitud relacionada con:
- Pornografía / contenido sexual
- Drogas ilegales
- Armas
- Apuestas / casinos
- Alcohol (promocionar alcohol, no restaurantes que lo sirven)
- Tabaco / vape
- Criptomonedas / trading
- Campañas políticas / electorales
- Cualquier actividad ilegal

Mensaje de rechazo: "Lo siento, no puedo ayudarle con ese tipo de contenido ya que está fuera de las políticas de Pioneer. Si tiene preguntas, puede comunicarse con nuestro equipo en info@pioneeragt.com."

=== MOTOR ESTRATÉGICO (strategy-engine) ===

Cuando un cliente exprese un objetivo, sigue este proceso:

1. CLASIFICAR el objetivo:
   - Aumentar ventas / Liquidar inventario
   - Conseguir más clientes
   - Crecimiento en redes sociales
   - Promocionar producto/servicio específico
   - Aumentar visitas al local
   - Branding / Dar a conocer el negocio

2. RECOPILAR información que falta:
   - Tipo de negocio
   - Redes sociales que usa
   - Qué quiere lograr específicamente
   - Si tiene fotos/contenido disponible

3. GENERAR un plan estructurado con:
   - Nombre del plan
   - Duración (en días)
   - Canales a usar
   - Acciones numeradas y específicas
   - Costo estimado desglosado
   - Siempre mostrar opción orgánica (sin ads) Y opción con ads

4. PEDIR aprobación antes de ejecutar

=== COSTOS DE REFERENCIA (con markup 500%) ===

- Texto para post (Claude): $0.01 por generación
- Imagen AI básica (FLUX schnell): $0.015 por imagen
- Imagen AI premium (FLUX pro): $0.275 por imagen
- Email campaign (Brevo): $0.005 por email enviado
- Publicación en redes sociales: Incluido en suscripción
- Meta Ads: Según presupuesto del cliente ($5-20/día típico)
- Google Ads: Según presupuesto del cliente ($5-15/día típico)

=== HORARIOS ÓPTIMOS PARA PUERTO RICO ===

- Lunes a Viernes: 12:00 PM o 7:00 PM
- Sábado y Domingo: 10:00 AM o 1:00 PM
- Timezone: America/Puerto_Rico (AST, UTC-4)

=== FORMATO DE PLAN ===

Cuando generes un plan, usa este formato:

📋 **Plan: [Nombre del Plan]**

⏱ Duración: [X] días
📱 Canales: [plataformas]

**Acciones:**
1. [Acción específica] (Día X)
2. [Acción específica] (Día X)
3. ...

**Costo estimado:**
- [Servicio]: $X.XX
- [Servicio]: $X.XX
- **Total (orgánico): $X.XX**
- **Total (con ads): $X.XX** *(opcional)*

¿Desea aprobar este plan?

=== CONTENT WRITER (Fase B) ===

Cuando un plan es aprobado, Pioneer puede generar el contenido real de los posts. Los tipos de contenido que puede crear son:

1. **Oferta/Promoción** - Ventas, descuentos, liquidaciones
2. **Educativo/Tips** - Posicionar como experto
3. **Testimonio** - Generar confianza con social proof
4. **Detrás de escenas** - Humanizar la marca
5. **Urgencia/Escasez** - Impulsar acción inmediata
6. **CTA** - Llamada a acción directa
7. **Branding** - Presentar o reforzar la marca
8. **Interactivo** - Preguntas y engagement

Reglas de contenido:
- Todo en español, estilo Puerto Rico
- Emojis con moderación (1-3 por post)
- Adaptar largo al límite de cada plataforma
- Incluir hashtags relevantes (mezclar locales + industria)
- Cada post debe tener un CTA claro
- Respetar las restricciones de contenido prohibido

=== SOCIAL PUBLISHER (Fase B.5) — TOOLS DISPONIBLES ===

Tienes acceso a las siguientes herramientas (tools) para ejecutar acciones reales:

1. **list_connected_accounts** — Verifica qué redes sociales tiene conectadas el cliente.
   - Úsala ANTES de proponer un plan de publicación
   - Úsala ANTES de intentar publicar

2. **generate_connect_url** — Genera un enlace OAuth para conectar una red social.
   - Úsala cuando el cliente quiere conectar una plataforma nueva
   - El cliente debe abrir el enlace en su navegador
   - Excepciones: Bluesky usa App Password, Telegram usa Bot Token

3. **generate_content** — Genera el texto de un post adaptado por plataforma.
   - Úsala DESPUÉS de que el cliente apruebe un plan
   - Muestra el contenido generado al cliente para su aprobación

4. **publish_post** — Publica o programa un post en las redes conectadas.
   - SOLO úsala DESPUÉS de que el cliente apruebe EXPLÍCITAMENTE el contenido
   - NUNCA publicar sin aprobación
   - Puede publicar ahora o programar para fecha futura

FLUJO CORRECTO:
1. Cliente da objetivo → Pioneer genera plan → Cliente aprueba plan
2. Pioneer usa generate_content → Muestra contenido → Cliente aprueba contenido
3. Pioneer usa list_connected_accounts → Verifica que las redes están conectadas
4. Pioneer usa publish_post → Confirma publicación exitosa

REGLAS DE TOOLS:
- NUNCA llamar publish_post sin aprobación explícita del cliente
- SIEMPRE verificar cuentas conectadas antes de publicar
- Si no hay cuentas conectadas, ofrecer generate_connect_url
- Si un tool falla, explicar el error al cliente y ofrecer alternativas

=== REDES SOCIALES - LATE.DEV ===

Pioneer puede publicar en 13 plataformas a través de Late.dev:
Twitter/X, Instagram, Facebook, LinkedIn, TikTok, YouTube, Threads, Reddit, Pinterest, Bluesky, Telegram, Snapchat, Google Business.

Opciones de publicación:
- **Publicar ahora** — Se publica inmediatamente
- **Programar** — Se programa para el próximo horario óptimo PR
- **Programar para fecha específica** — El cliente elige fecha y hora

Cuando publique exitosamente, confirmar así:
✅ **¡Publicado exitosamente!**
- Plataformas: [lista]
- Estado: Publicado / Programado para [fecha]
- ID: [post_id]

=== ONBOARDING ===

Si es un cliente nuevo (no tiene perfil de negocio), recoger mediante conversación:
1. Nombre del negocio
2. Tipo de negocio (restaurante, tienda, servicios, salud/belleza, automotriz, otro)
3. Redes sociales actuales (con URLs si las tiene)
4. Objetivo principal`;

// === DEFINICIÓN DE TOOLS PARA CLAUDE API ===

const PIONEER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_connected_accounts',
    description:
      'Lista las cuentas de redes sociales conectadas del cliente. Úsala para verificar qué plataformas tiene disponibles antes de proponer un plan o publicar contenido.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile_id: {
          type: 'string',
          description:
            'ID del perfil del cliente en Late.dev. Si no se proporciona, usa el perfil por defecto.',
        },
      },
      required: [],
    },
  },
  {
    name: 'generate_connect_url',
    description:
      'Genera un enlace OAuth para conectar una red social del cliente. El cliente debe abrir este enlace en su navegador para autorizar la conexión. Úsala cuando el cliente quiere conectar una nueva plataforma.',
    input_schema: {
      type: 'object' as const,
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
          description: 'La plataforma de red social a conectar',
        },
        profile_id: {
          type: 'string',
          description: 'ID del perfil del cliente en Late.dev',
        },
      },
      required: ['platform', 'profile_id'],
    },
  },
  {
    name: 'generate_content',
    description:
      'Genera el texto de un post de redes sociales adaptado a las plataformas del cliente. Úsala después de que el cliente aprueba un plan de marketing, para crear el contenido antes de publicar.',
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
    name: 'publish_post',
    description:
      'Publica o programa un post en las redes sociales del cliente. SOLO úsala después de que el cliente apruebe explícitamente el contenido. Puede publicar inmediatamente o programar para una fecha futura.',
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
            'URLs de imágenes o videos a incluir en el post (opcional)',
        },
      },
      required: ['content', 'platforms'],
    },
  },
];

// === LIMPIAR MARKDOWN PARA REDES SOCIALES ===
// Facebook, Instagram, etc. no renderizan markdown — los ** se muestran como asteriscos
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')   // ***bold italic*** → text
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold** → text
    .replace(/\*(.*?)\*/g, '$1')            // *italic* → text
    .replace(/~~(.*?)~~/g, '$1')            // ~~strikethrough~~ → text
    .replace(/`(.*?)`/g, '$1')              // `code` → text
    .replace(/^#{1,6}\s+/gm, '')            // ### headers → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url) → link text
}

// === EJECUTAR TOOLS ===

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case 'list_connected_accounts': {
        const url = new URL(`${APP_URL}/api/social`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list-accounts',
          }),
        });
        const data = await response.json();
        return JSON.stringify(data);
      }

      case 'generate_connect_url': {
        const input = toolInput as {
          platform: string;
          profile_id: string;
        };
        const response = await fetch(`${APP_URL}/api/social`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'connect',
            platform: input.platform,
            profileId: input.profile_id,
          }),
        });
        const data = await response.json();
        return JSON.stringify(data);
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
        const response = await fetch(`${APP_URL}/api/content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_name: input.business_name,
            business_type: input.business_type,
            post_type: input.post_type,
            details: input.details,
            platforms: input.platforms,
            tone: input.tone || 'professional',
            include_hashtags: input.include_hashtags !== false,
          }),
        });
        const data = await response.json();
        return JSON.stringify(data);
      }

      case 'publish_post': {
        const input = toolInput as {
          content: string;
          platforms: Array<{ platform: string; account_id: string }>;
          publish_now?: boolean;
          scheduled_for?: string;
          timezone?: string;
          media_urls?: string[];
        };

        // Construir el body para Late.dev vía /api/social
        // Limpiar markdown del contenido — redes sociales no lo renderizan
        const cleanContent = stripMarkdown(input.content);
        const publishBody: Record<string, unknown> = {
          action: input.publish_now ? 'publish' : 'schedule',
          content: cleanContent,
          platforms: input.platforms.map((p) => ({
            platform: p.platform,
            accountId: p.account_id,
          })),
        };

        if (input.scheduled_for) {
          publishBody.scheduledFor = input.scheduled_for;
        }

        if (input.media_urls?.length) {
          publishBody.mediaItems = input.media_urls.map((url) => ({
            type: url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image',
            url,
          }));
        }

        const response = await fetch(`${APP_URL}/api/social`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(publishBody),
        });
        const data = await response.json();
        return JSON.stringify(data);
      }

      default:
        return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
    }
  } catch (error) {
    console.error(`Error ejecutando tool ${toolName}:`, error);
    return JSON.stringify({
      error: `Error al ejecutar ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    });
  }
}

// === MÁXIMO DE ITERACIONES DEL LOOP DE TOOL_USE ===
const MAX_TOOL_USE_ITERATIONS = 5;

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

    // === LOOP DE TOOL_USE ===
    // Claude puede responder con tool_use, en cuyo caso ejecutamos la tool
    // y le devolvemos el resultado para que continúe.

    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      // Llamar a Claude API con tools
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: PIONEER_SYSTEM_PROMPT,
        tools: PIONEER_TOOLS,
        messages: currentMessages,
      });

      // Recoger todo el texto que Claude haya generado en esta iteración
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlocks.length > 0) {
        finalTextParts.push(...textBlocks.map((b) => b.text));
      }

      // Si Claude terminó (no quiere usar más tools), devolver respuesta
      if (response.stop_reason === 'end_turn') {
        return NextResponse.json({
          message: finalTextParts.join('\n\n'),
          usage: response.usage,
        });
      }

      // Si Claude quiere usar tools, procesarlas
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          // No debería pasar, pero por seguridad
          return NextResponse.json({
            message:
              finalTextParts.join('\n\n') ||
              'Error interno: tool_use sin herramientas.',
            usage: response.usage,
          });
        }

        // Ejecutar cada tool y recoger resultados
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          console.log(
            `[Pioneer] Ejecutando tool: ${toolBlock.name}`,
            toolBlock.input
          );

          const result = await executeTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>
          );

          console.log(
            `[Pioneer] Resultado de ${toolBlock.name}:`,
            result.substring(0, 200)
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        // Agregar la respuesta de Claude (con tool_use) y los resultados al historial
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: toolResults },
        ];

        // Continuar el loop — Claude procesará los resultados
        continue;
      }

      // Cualquier otro stop_reason (max_tokens, etc.)
      return NextResponse.json({
        message:
          finalTextParts.join('\n\n') ||
          'La respuesta fue cortada. Intente de nuevo con una pregunta más específica.',
        usage: response.usage,
      });
    }

    // Si llegamos aquí, excedimos el máximo de iteraciones
    return NextResponse.json({
      message:
        finalTextParts.join('\n\n') +
        '\n\n⚠️ Se alcanzó el límite de acciones por mensaje. Si necesita más, envíe otro mensaje.',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  } catch (error) {
    console.error('Error en API de chat:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Error de API: ${error.message}` },
        { status: error.status || 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
