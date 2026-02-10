// Ejecutor de tools para Pioneer Agent — Fase 3
// Llamadas directas a APIs (sin fetch HTTP — regla Vercel serverless)
//
// === TOOLS ACTIVAS (7) ===
// list_connected_accounts, generate_connect_url, generate_content,
// describe_image, get_pending_connection, complete_connection, setup_queue
//
// generate_image, create_draft, publish_post → movidos a action-handler.ts (botones de acción)
// Claude solo DISEÑA. El cliente EJECUTA.

import {
  listAccounts,
  getConnectUrl,
  PR_TIMEZONE,
  LateApiError,
  deletePost,
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
  // Queue functions
  setupQueueSlots,
  getQueueNextSlot,
} from '@/lib/late-client';
import { generateContent } from '@/lib/content-generator';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import type { Platform } from '@/lib/types';

// === TIPO DE RETORNO DE executeTool ===
export interface ToolResult {
  result: string;
  shouldClearOAuthCookie: boolean;
  linkedInDataToCache: Record<string, unknown> | null;
  connectionOptionsToCache: Array<{ id: string; name: string }> | null;
}

// === DEFAULT RESULT HELPER ===
function defaultResult(result: string, overrides?: Partial<ToolResult>): ToolResult {
  return {
    result,
    shouldClearOAuthCookie: false,
    linkedInDataToCache: null,
    connectionOptionsToCache: null,
    ...overrides,
  };
}

// === EJECUTAR TOOLS ===

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  // OAuth headless context
  pendingOAuthData: OAuthPendingData | null,
  linkedInCachedData: Record<string, unknown> | null,
  cachedConnectionOptions: Array<{ id: string; name: string }> | null
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'list_connected_accounts': {
        const result = await listAccounts();
        return defaultResult(JSON.stringify({
          success: true,
          accounts: result.accounts,
          count: result.accounts.length,
        }));
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

        const headless = isHeadlessPlatform(input.platform);

        return defaultResult(JSON.stringify({
          success: true,
          authUrl: result.authUrl,
          platform: input.platform,
          headless,
          ...(headless && {
            _note_for_pioneer: `Esta plataforma (${input.platform}) usa modo headless. Después de que el cliente autorice, regresará al chat con un mensaje automático. En ese momento debes llamar get_pending_connection para obtener las opciones de selección.`,
          }),
        }));
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
        return defaultResult(JSON.stringify(result));
      }

      case 'describe_image': {
        // Fase 3: Claude NO genera la imagen — solo describe qué generar.
        // Retorna la spec como JSON. El sistema muestra botones para que el cliente ejecute.
        const input = toolInput as {
          prompt: string;
          model?: string;
          aspect_ratio?: string;
          count?: number;
        };

        const spec = {
          prompt: input.prompt,
          model: input.model || 'schnell',
          aspect_ratio: input.aspect_ratio || '1:1',
          count: input.count || 1,
        };

        const costPerImage = spec.model === 'pro' ? 0.275 : 0.015;
        const totalCost = costPerImage * spec.count;

        return defaultResult(JSON.stringify({
          success: true,
          image_spec: spec,
          estimated_cost: `$${totalCost.toFixed(3)}`,
          _note_for_pioneer: `Imagen descrita exitosamente. Presenta la descripción al cliente. El sistema mostrará botones [🎨 Generar imagen] [⭕ Sin imagen] automáticamente. NO intentes generar la imagen tú mismo.`,
        }));
      }

      // === TOOL: Queue ===

      case 'setup_queue': {
        const input = toolInput as {
          slots: Array<{ day_of_week: number; time: string }>;
          profile_id?: string;
        };

        const profileId = input.profile_id || '6984c371b984889d86a8b3d6';

        try {
          const formattedSlots = input.slots.map(s => ({
            dayOfWeek: s.day_of_week,
            time: s.time,
          }));

          await setupQueueSlots(profileId, PR_TIMEZONE, formattedSlots, true);

          let nextSlotInfo = '';
          try {
            const nextSlot = await getQueueNextSlot(profileId);
            nextSlotInfo = ` Próximo horario disponible: ${nextSlot.nextSlot}`;
          } catch {
            // No-op: info opcional
          }

          const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
          const slotDescriptions = formattedSlots.map(s => `${days[s.dayOfWeek]} a las ${s.time}`);

          return defaultResult(JSON.stringify({
            success: true,
            message: `Cola de publicación configurada: ${slotDescriptions.join(', ')}.${nextSlotInfo}`,
            slots: formattedSlots,
            timezone: PR_TIMEZONE,
            profile_id: profileId,
          }));
        } catch (error) {
          console.error('[Pioneer] Error configurando queue:', error);
          const errorMessage = error instanceof LateApiError
            ? `Error de Late.dev (HTTP ${error.status}): ${error.body}`
            : error instanceof Error ? error.message : 'Error desconocido';

          return defaultResult(JSON.stringify({
            success: false,
            error: `Error configurando cola de publicación: ${errorMessage}`,
          }));
        }
      }

      // ============================================================
      // === TOOLS: OAuth Headless ===
      // ============================================================

      case 'get_pending_connection': {
        const pending = pendingOAuthData;

        if (!pending) {
          return defaultResult(JSON.stringify({
            success: false,
            error: 'No hay conexión pendiente. La sesión de autorización pudo haber expirado (10 minutos). El cliente debe intentar conectar la plataforma de nuevo usando generate_connect_url.',
          }));
        }

        const { platform, step, profileId, tempToken, connectToken, pendingDataToken } = pending;

        console.log(`[Pioneer] get_pending_connection: ${platform} (step: ${step})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener páginas de Facebook. El cliente debe intentar conectar de nuevo.',
                }));
              }
              const fbResult = await getFacebookPages(profileId, tempToken, connectToken);
              const fbOptions = fbResult.pages.map(p => ({
                id: p.id,
                name: p.name,
                username: p.username || '',
                category: p.category || '',
              }));
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'pages',
                options: fbOptions,
                message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente para que elija una.`,
              }), {
                connectionOptionsToCache: fbOptions,
              });
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos pendientes para LinkedIn. El cliente debe intentar conectar de nuevo.',
                }));
              }

              const liData = await getLinkedInPendingData(pendingDataToken);

              const options: Array<{ id: string; name: string; type: string }> = [];

              if (liData.userProfile?.displayName) {
                options.push({
                  id: 'personal',
                  name: `${liData.userProfile.displayName} (Personal)`,
                  type: 'personal',
                });
              }

              if (liData.organizations?.length) {
                for (const org of liData.organizations) {
                  options.push({
                    id: org.id,
                    name: org.name,
                    type: 'organization',
                  });
                }
              }

              if (options.length === 0) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'No se encontraron perfiles ni organizaciones de LinkedIn.',
                }));
              }

              return defaultResult(JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'profiles',
                options,
                message: `Se encontraron ${options.length} opción(es) de LinkedIn. Muestre las opciones al cliente.`,
              }), {
                linkedInDataToCache: liData as unknown as Record<string, unknown>,
                connectionOptionsToCache: options,
              });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener boards de Pinterest.',
                }));
              }
              const boards = await getPinterestBoards(profileId, tempToken, connectToken);
              const boardOptions = boards.boards.map(b => ({
                id: b.id,
                name: b.name,
              }));
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'boards',
                options: boardOptions,
                message: `Se encontraron ${boardOptions.length} board(s) de Pinterest. Muestre las opciones al cliente.`,
              }), {
                connectionOptionsToCache: boardOptions,
              });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener ubicaciones de Google Business.',
                }));
              }
              const locations = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
              const locationOptions = locations.locations.map(l => ({
                id: l.id,
                name: l.name,
              }));
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'locations',
                options: locationOptions,
                message: `Se encontraron ${locationOptions.length} ubicación(es) de Google Business. Muestre las opciones al cliente.`,
              }), {
                connectionOptionsToCache: locationOptions,
              });
            }

            case 'snapchat': {
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'confirm',
                options: [{ id: 'default', name: 'Perfil público de Snapchat' }],
                message: 'Snapchat solo tiene una opción: el perfil público. Confirme con el cliente.',
              }), {
                connectionOptionsToCache: [{ id: 'default', name: 'Perfil público de Snapchat' }],
              });
            }

            default:
              return defaultResult(JSON.stringify({
                success: false,
                error: `Plataforma no soportada para conexión headless: ${platform}`,
              }));
          }
        } catch (error) {
          console.error(`[Pioneer] Error en get_pending_connection para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return defaultResult(JSON.stringify({
              success: false,
              error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
              expired: true,
            }), { shouldClearOAuthCookie: true });
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
          return defaultResult(JSON.stringify({
            success: false,
            error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.',
          }));
        }

        const { platform, profileId, tempToken, connectToken, userProfile } = pending;
        const { selection_id, selection_name } = input;

        console.log(`[Pioneer] complete_connection: ${platform}, selection: ${selection_id} (${selection_name})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la selección de Facebook. El cliente debe intentar conectar de nuevo.',
                }));
              }

              // === BUG 8.5 FIX: Re-fetch pages para validar selection_id ===
              let validatedSelectionId = selection_id;
              try {
                const fbPages = await getFacebookPages(profileId, tempToken, connectToken);
                const realPages = fbPages.pages;

                const exactMatch = realPages.find(p => p.id === selection_id);
                if (!exactMatch) {
                  console.warn(`[Pioneer] ⚠️ selection_id "${selection_id}" no coincide con ninguna page real. Intentando auto-corrección...`);

                  if (selection_name) {
                    const nameMatch = realPages.find(p =>
                      p.name.toLowerCase() === selection_name.toLowerCase()
                    );
                    if (nameMatch) {
                      console.log(`[Pioneer] ⚠️ CORRECCIÓN FB: ID "${selection_id}" → "${nameMatch.id}" (match por nombre: "${nameMatch.name}")`);
                      validatedSelectionId = nameMatch.id;
                    }
                  }

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
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`,
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            case 'linkedin': {
              const liData = input._linkedin_data || (linkedInCachedData as {
                tempToken: string;
                userProfile: Record<string, unknown>;
                organizations: Array<{ id: string; urn: string; name: string }>;
              } | null);

              if (!liData || !connectToken) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos de LinkedIn para guardar la selección. El cliente puede necesitar intentar conectar de nuevo.',
                }));
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

              return defaultResult(JSON.stringify({
                success: true,
                platform,
                message: isPersonal
                  ? `LinkedIn conectado como cuenta personal de ${liData.userProfile.displayName || 'usuario'}.`
                  : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la selección de Pinterest. El cliente debe intentar conectar de nuevo.',
                }));
              }
              await savePinterestBoard(profileId, selection_id, selection_name || selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`,
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la ubicación de Google Business. El cliente debe intentar conectar de nuevo.',
                }));
              }
              await saveGoogleBusinessLocation(profileId, selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`,
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            case 'snapchat': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar el perfil de Snapchat. El cliente debe intentar conectar de nuevo.',
                }));
              }
              await saveSnapchatProfile(profileId, selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({
                success: true,
                platform,
                message: 'Perfil público de Snapchat conectado exitosamente.',
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            default:
              return defaultResult(JSON.stringify({
                success: false,
                error: `Plataforma no soportada para completar conexión: ${platform}`,
              }));
          }
        } catch (error) {
          console.error(`[Pioneer] Error completando conexión para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return defaultResult(JSON.stringify({
              success: false,
              error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
              expired: true,
            }), { shouldClearOAuthCookie: true });
          }

          throw error;
        }
      }

      default:
        return defaultResult(JSON.stringify({
          error: `Tool desconocida: ${toolName}`,
        }));
    }
  } catch (error) {
    console.error(`[Pioneer] Error ejecutando tool ${toolName}:`, error);
    return defaultResult(JSON.stringify({
      success: false,
      error: `Error ejecutando ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    }));
  }
}
