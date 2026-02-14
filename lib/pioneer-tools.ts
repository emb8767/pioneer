// pioneer-tools.ts — Pioneer OAuth tools for AI SDK 6
//
// Replaces: tool-definitions.ts (schemas) + tool-executor.ts (execution)
//
// CRITICAL: AI SDK 6 uses `inputSchema` NOT `parameters`.
// The tool() helper requires inputSchema for proper type inference.

import { z } from 'zod';
import { tool } from 'ai';
import {
  listAccounts,
  getConnectUrl,
  LateApiError,
  // Headless OAuth
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
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import type { Platform } from '@/lib/types';

// === MUTABLE STATE REFS ===
export interface ToolRuntimeState {
  shouldClearOAuthCookie: boolean;
  linkedInCachedData: Record<string, unknown> | null;
  cachedConnectionOptions: Array<{ id: string; name: string }> | null;
}

// === TOOL FACTORY ===
export function createPioneerTools(
  pendingOAuthData: OAuthPendingData | null,
  state: ToolRuntimeState,
) {
  return {
    // ═══════════════════════════════════════
    // TOOL 1: List connected accounts
    // ═══════════════════════════════════════
    list_connected_accounts: tool({
      description:
        'Lista las cuentas de redes sociales conectadas del cliente. Úsala ANTES de proponer un plan o publicar, para saber en qué plataformas puede publicar.',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute: async () => {
        try {
          const result = await listAccounts();
          const accounts = result.accounts || result || [];
          if (!accounts || accounts.length === 0) {
            return JSON.stringify({
              success: true,
              accounts: [],
              count: 0,
              message: 'No hay cuentas conectadas. Sugiere al cliente conectar una red social.',
            });
          }
          const formatted = accounts.map((acc: any) => ({
            _id: acc._id,
            platform: acc.platform,
            name: acc.name || acc.username || 'Sin nombre',
            username: acc.username || null,
          }));
          return JSON.stringify({
            success: true,
            accounts: formatted,
            count: formatted.length,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Error desconocido';
          return JSON.stringify({ success: false, error: msg });
        }
      },
    }),

    // ═══════════════════════════════════════
    // TOOL 2: Generate connect URL (OAuth)
    // ═══════════════════════════════════════
    generate_connect_url: tool({
      description:
        'Genera un enlace de autorización OAuth para conectar una red social. Para plataformas headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat), el modo headless se activa automáticamente.',
      inputSchema: z.object({
        platform: z.enum([
          'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok',
          'youtube', 'threads', 'reddit', 'pinterest', 'bluesky',
          'googlebusiness', 'telegram', 'snapchat',
        ]).describe('La plataforma de red social a conectar'),
        profile_id: z.string().describe('ID del perfil en Late.dev').default('6984c371b984889d86a8b3d6'),
      }),
      outputSchema: z.string(),
      execute: async ({ platform, profile_id }) => {
        try {
          const headless = isHeadlessPlatform(platform as Platform);
          const result = await getConnectUrl(platform as Platform, profile_id);

          return JSON.stringify({
            success: true,
            authUrl: result.authUrl,
            platform,
            headless,
            ...(headless && {
              _note_for_pioneer: `Esta plataforma (${platform}) usa modo headless. Después de que el cliente autorice, regresará al chat con un mensaje automático. En ese momento debes llamar get_pending_connection.`,
            }),
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Error desconocido';
          return JSON.stringify({ success: false, error: msg });
        }
      },
    }),

    // ═══════════════════════════════════════
    // TOOL 3: Get pending connection (headless)
    // ═══════════════════════════════════════
    get_pending_connection: tool({
      description:
        'Obtiene las opciones de selección para completar una conexión de red social headless. Llámala INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless.',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute: async () => {
        if (!pendingOAuthData) {
          return JSON.stringify({
            success: false,
            error: 'No hay conexión pendiente. La sesión pudo haber expirado (10 min). El cliente debe intentar conectar de nuevo.',
          });
        }

        const { platform, step, profileId, tempToken, connectToken, pendingDataToken } = pendingOAuthData;
        console.log(`[Pioneer] get_pending_connection: ${platform} (step: ${step})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener páginas de Facebook. El cliente debe intentar conectar de nuevo.',
                });
              }
              const fbResult = await getFacebookPages(profileId, tempToken, connectToken);
              const fbOptions = fbResult.pages.map((p: any) => ({
                id: p.id,
                name: p.name,
                username: p.username || '',
                category: p.category || '',
              }));
              state.cachedConnectionOptions = fbOptions;
              return JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'pages',
                options: fbOptions,
                message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente.`,
              });
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos pendientes para LinkedIn. El cliente debe intentar conectar de nuevo.',
                });
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
                  options.push({ id: org.id, name: org.name, type: 'organization' });
                }
              }
              if (options.length === 0) {
                return JSON.stringify({
                  success: false,
                  error: 'No se encontraron perfiles ni organizaciones de LinkedIn.',
                });
              }

              state.linkedInCachedData = liData as unknown as Record<string, unknown>;
              state.cachedConnectionOptions = options;
              return JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'profiles',
                options,
                message: `Se encontraron ${options.length} opción(es) de LinkedIn. Muestre las opciones al cliente.`,
              });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener boards de Pinterest.',
                });
              }
              const boards = await getPinterestBoards(profileId, tempToken, connectToken);
              const boardOptions = boards.boards.map((b: any) => ({
                id: b.id,
                name: b.name,
              }));
              state.cachedConnectionOptions = boardOptions;
              return JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'boards',
                options: boardOptions,
                message: `Se encontraron ${boardOptions.length} board(s) de Pinterest.`,
              });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan tokens para obtener ubicaciones de Google Business.',
                });
              }
              const locations = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
              const locationOptions = locations.locations.map((l: any) => ({
                id: l.id,
                name: l.name,
              }));
              state.cachedConnectionOptions = locationOptions;
              return JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'locations',
                options: locationOptions,
                message: `Se encontraron ${locationOptions.length} ubicación(es) de Google Business.`,
              });
            }

            case 'snapchat': {
              state.cachedConnectionOptions = [{ id: 'default', name: 'Perfil público de Snapchat' }];
              return JSON.stringify({
                success: true,
                platform,
                step,
                options_type: 'confirm',
                options: [{ id: 'default', name: 'Perfil público de Snapchat' }],
                message: 'Snapchat solo tiene una opción: el perfil público. Confirme con el cliente.',
              });
            }

            default:
              return JSON.stringify({
                success: false,
                error: `Plataforma no soportada para conexión headless: ${platform}`,
              });
          }
        } catch (error) {
          console.error(`[Pioneer] Error en get_pending_connection para ${platform}:`, error);
          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            state.shouldClearOAuthCookie = true;
            return JSON.stringify({
              success: false,
              error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar de nuevo.',
              expired: true,
            });
          }
          throw error;
        }
      },
    }),

    // ═══════════════════════════════════════
    // TOOL 4: Complete connection (headless)
    // ═══════════════════════════════════════
    complete_connection: tool({
      description:
        'Completa una conexión headless guardando la selección del cliente. Para LinkedIn, DEBES incluir _linkedin_data.',
      inputSchema: z.object({
        platform: z.enum(['facebook', 'instagram', 'linkedin', 'pinterest', 'googlebusiness', 'snapchat'])
          .describe('La plataforma para la que se completa la conexión'),
        selection_id: z.string().describe('El ID de la opción seleccionada por el cliente'),
        selection_name: z.string().optional().describe('El nombre de la opción seleccionada'),
        _linkedin_data: z.object({
          tempToken: z.string(),
          userProfile: z.record(z.string(), z.unknown()),
          organizations: z.array(z.object({
            id: z.string(),
            urn: z.string(),
            name: z.string(),
          })),
        }).optional().describe('Datos de LinkedIn devueltos por get_pending_connection. OBLIGATORIO para LinkedIn.'),
      }),
      outputSchema: z.string(),
      execute: async ({ platform, selection_id, selection_name, _linkedin_data }) => {
        if (!pendingOAuthData) {
          return JSON.stringify({
            success: false,
            error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.',
          });
        }

        const { profileId, tempToken, connectToken, userProfile } = pendingOAuthData;
        console.log(`[Pioneer] complete_connection: ${platform}, selection: ${selection_id} (${selection_name})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken || !userProfile) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la selección de Facebook. El cliente debe intentar conectar de nuevo.',
                });
              }

              let validatedSelectionId = selection_id;
              try {
                const fbPages = await getFacebookPages(profileId, tempToken, connectToken);
                const realPages = fbPages.pages;
                const exactMatch = realPages.find((p: any) => p.id === selection_id);

                if (!exactMatch) {
                  console.warn(`[Pioneer] ⚠️ selection_id "${selection_id}" no coincide. Intentando auto-corrección...`);
                  if (selection_name) {
                    const nameMatch = realPages.find((p: any) =>
                      (p.name as string).toLowerCase() === selection_name.toLowerCase()
                    );
                    if (nameMatch) {
                      console.log(`[Pioneer] ⚠️ CORRECCIÓN FB: "${selection_id}" → "${nameMatch.id}"`);
                      validatedSelectionId = nameMatch.id as string;
                    }
                  }
                  if (validatedSelectionId === selection_id && realPages.length === 1) {
                    console.log(`[Pioneer] ⚠️ CORRECCIÓN FB: única page "${realPages[0].id}"`);
                    validatedSelectionId = realPages[0].id as string;
                  }
                }
              } catch (fetchErr) {
                console.warn('[Pioneer] No se pudieron re-fetch pages:', fetchErr);
              }

              await saveFacebookPage(profileId, validatedSelectionId, tempToken, userProfile, connectToken);
              state.shouldClearOAuthCookie = true;
              return JSON.stringify({
                success: true,
                platform,
                message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`,
                connected: true,
              });
            }

            case 'linkedin': {
              const liData = _linkedin_data || (state.linkedInCachedData as {
                tempToken: string;
                userProfile: Record<string, unknown>;
                organizations: Array<{ id: string; urn: string; name: string }>;
              } | null);

              if (!liData || !connectToken) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos de LinkedIn. El cliente puede necesitar intentar conectar de nuevo.',
                });
              }

              const isPersonal = selection_id === 'personal';
              const selectedOrg = isPersonal
                ? undefined
                : liData.organizations.find((o) => o.id === selection_id);

              await saveLinkedInOrganization(
                profileId,
                liData.tempToken,
                liData.userProfile,
                isPersonal ? 'personal' : 'organization',
                connectToken,
                selectedOrg
              );

              state.shouldClearOAuthCookie = true;
              return JSON.stringify({
                success: true,
                platform,
                message: isPersonal
                  ? `LinkedIn conectado como cuenta personal de ${liData.userProfile.displayName || 'usuario'}.`
                  : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
                connected: true,
              });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken || !userProfile) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la selección de Pinterest.',
                });
              }
              await savePinterestBoard(profileId, selection_id, selection_name || selection_id, tempToken, userProfile, connectToken);
              state.shouldClearOAuthCookie = true;
              return JSON.stringify({
                success: true,
                platform,
                message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`,
                connected: true,
              });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken || !userProfile) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar la ubicación de Google Business.',
                });
              }
              await saveGoogleBusinessLocation(profileId, selection_id, tempToken, userProfile, connectToken);
              state.shouldClearOAuthCookie = true;
              return JSON.stringify({
                success: true,
                platform,
                message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`,
                connected: true,
              });
            }

            case 'snapchat': {
              if (!tempToken || !connectToken || !userProfile) {
                return JSON.stringify({
                  success: false,
                  error: 'Faltan datos para guardar el perfil de Snapchat.',
                });
              }
              await saveSnapchatProfile(profileId, selection_id, tempToken, userProfile, connectToken);
              state.shouldClearOAuthCookie = true;
              return JSON.stringify({
                success: true,
                platform,
                message: 'Perfil público de Snapchat conectado exitosamente.',
                connected: true,
              });
            }

            default:
              return JSON.stringify({
                success: false,
                error: `Plataforma no soportada para completar conexión: ${platform}`,
              });
          }
        } catch (error) {
          console.error(`[Pioneer] Error completando conexión para ${platform}:`, error);
          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            state.shouldClearOAuthCookie = true;
            return JSON.stringify({
              success: false,
              error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar de nuevo.',
              expired: true,
            });
          }
          throw error;
        }
      },
    }),
  };
}
