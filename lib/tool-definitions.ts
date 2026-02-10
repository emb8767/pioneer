import Anthropic from '@anthropic-ai/sdk';

// === TOOLS DISPONIBLES PARA CLAUDE (7 tools) ===
// Fase 3: generate_image reemplazado por describe_image
// Claude DISEÑA todo (texto, imagen spec). El CLIENTE ejecuta acciones (generar imagen, publicar).
// Acciones del cliente van via /api/chat/action (sin pasar por Claude).
export const PIONEER_TOOLS: Anthropic.Tool[] = [
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
            'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok',
            'youtube', 'threads', 'reddit', 'pinterest', 'bluesky',
            'googlebusiness', 'telegram', 'snapchat',
          ],
          description: 'La plataforma de red social a conectar',
        },
        profile_id: {
          type: 'string',
          description: 'ID del perfil del cliente en Late.dev (default: 6984c371b984889d86a8b3d6)',
        },
      },
      required: ['platform', 'profile_id'],
    },
  },
  {
    name: 'generate_content',
    description:
      'Genera texto de post optimizado para redes sociales. SIEMPRE usar esta tool — NUNCA generar texto manualmente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        business_name: {
          type: 'string',
          description: 'Nombre del negocio',
        },
        business_type: {
          type: 'string',
          description: 'Tipo de negocio (ej: panadería, gomera, restaurante)',
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
    name: 'describe_image',
    description:
      'Describe la imagen que se debe generar para acompañar un post. TÚ NO generas la imagen — solo describes qué imagen crear. El sistema mostrará un botón al cliente para que ejecute la generación. El prompt DEBE ser en inglés. Después de llamar esta tool, presenta la descripción al cliente y ESPERA — el sistema muestra botones automáticamente.',
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
            'Cantidad de imágenes (1-10). Usar > 1 para carruseles. Cada imagen cuesta $0.015 (schnell). Default: 1.',
        },
      },
      required: ['prompt'],
    },
  },
  // === TOOLS: OAuth Headless ===
  {
    name: 'get_pending_connection',
    description:
      'Obtiene las opciones de selección para completar una conexión de red social headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat). Llámala INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'complete_connection',
    description:
      'Completa una conexión headless guardando la selección del cliente. Llámala después de que el cliente selecciona una opción de las devueltas por get_pending_connection. Para LinkedIn, DEBES incluir _linkedin_data.',
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
          description: 'El ID de la opción seleccionada por el cliente',
        },
        selection_name: {
          type: 'string',
          description: 'El nombre de la opción seleccionada (para confirmación)',
        },
        _linkedin_data: {
          type: 'object',
          description: 'Datos de LinkedIn devueltos por get_pending_connection. OBLIGATORIO para LinkedIn.',
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
  // === TOOL: Queue ===
  {
    name: 'setup_queue',
    description:
      'Configura los horarios recurrentes de publicación para el cliente. Los horarios se repiten semanalmente. Solo necesita configurarse una vez por plan.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day_of_week: {
                type: 'number',
                description: 'Día de la semana: 0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado',
              },
              time: {
                type: 'string',
                description: 'Hora en formato HH:MM (ej: "12:00", "19:00")',
              },
            },
            required: ['day_of_week', 'time'],
          },
          description: 'Lista de horarios semanales de publicación.',
        },
        profile_id: {
          type: 'string',
          description: 'ID del perfil en Late.dev. Default: 6984c371b984889d86a8b3d6',
        },
      },
      required: ['slots'],
    },
  },
];
