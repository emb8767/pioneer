import Anthropic from '@anthropic-ai/sdk';

// === TOOLS DISPONIBLES PARA CLAUDE (4 tools — solo OAuth/conexión) ===
// Fase 5: generate_content y setup_queue eliminadas.
// Claude = pensar, analizar, diseñar.
// Action-handler = ejecutar (queue, content, imagen, publicar).
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
];
