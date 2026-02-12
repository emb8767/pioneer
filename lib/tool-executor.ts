// tool-executor.ts — Fase 5 cleanup
//
// === TOOLS ACTIVAS (4 — solo OAuth) ===
// list_connected_accounts, generate_connect_url,
// get_pending_connection, complete_connection
//
// generate_content, setup_queue, describe_image → ELIMINADAS
// Ahora en action-handler.ts (pipeline determinístico)

import {
  listAccounts,
  getConnectUrl,
  LateApiError,
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

// === TIPO DE RETORNO ===
export interface ToolResult {
  result: string;
  shouldClearOAuthCookie: boolean;
  linkedInDataToCache: Record<string, unknown> | null;
  connectionOptionsToCache: Array<{ id: string; name: string }> | null;
}

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
  pendingOAuthData: OAuthPendingData | null,
  linkedInCachedData: Record<string, unknown> | null,
  cachedConnectionOptions: Array<{ id: string; name: string }> | null,
  sessionId: string | null
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
        const input = toolInput as { platform: string; profile_id: string };
        const result = await getConnectUrl(input.platform as Platform, input.profile_id);
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
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan tokens para obtener páginas de Facebook. El cliente debe intentar conectar de nuevo.' }));
              }
              const fbResult = await getFacebookPages(profileId, tempToken, connectToken);
              const fbOptions = fbResult.pages.map(p => ({ id: p.id, name: p.name, username: p.username || '', category: p.category || '' }));
              return defaultResult(JSON.stringify({
                success: true, platform, step, options_type: 'pages', options: fbOptions,
                message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente para que elija una.`,
              }), { connectionOptionsToCache: fbOptions });
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos de LinkedIn. El cliente debe intentar conectar de nuevo.' }));
              }
              const liResult = await getLinkedInPendingData(pendingDataToken);
              const liOptions = [
                { id: 'personal', name: `Perfil personal: ${liResult.userProfile.displayName || 'Usuario'}` },
                ...(liResult.organizations || []).map(org => ({ id: org.id, name: `Empresa: ${org.name}` })),
              ];
              return defaultResult(JSON.stringify({
                success: true, platform, step, options_type: 'profiles', options: liOptions,
                message: 'Muestre las opciones al cliente (perfil personal o empresa).',
              }), {
                linkedInDataToCache: { tempToken: liResult.tempToken, userProfile: liResult.userProfile, organizations: liResult.organizations },
                connectionOptionsToCache: liOptions,
              });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan tokens para obtener boards de Pinterest. El cliente debe intentar conectar de nuevo.' }));
              }
              const pinResult = await getPinterestBoards(profileId, tempToken, connectToken);
              const pinOptions = pinResult.boards.map(b => ({ id: b.id, name: b.name }));
              return defaultResult(JSON.stringify({
                success: true, platform, step, options_type: 'boards', options: pinOptions,
                message: `Se encontraron ${pinResult.boards.length} board(s) de Pinterest.`,
              }), { connectionOptionsToCache: pinOptions });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan tokens para obtener ubicaciones de Google Business. El cliente debe intentar conectar de nuevo.' }));
              }
              const gbResult = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
              const gbOptions = gbResult.locations.map(loc => ({ id: loc.id, name: loc.name }));
              return defaultResult(JSON.stringify({
                success: true, platform, step, options_type: 'locations', options: gbOptions,
                message: `Se encontraron ${gbResult.locations.length} ubicación(es) de Google Business.`,
              }), { connectionOptionsToCache: gbOptions });
            }

            case 'snapchat': {
              return defaultResult(JSON.stringify({
                success: true, platform, step, options_type: 'confirm',
                options: [{ id: 'default', name: 'Perfil público de Snapchat' }],
                message: 'Confirme la conexión del perfil público de Snapchat.',
              }));
            }

            default:
              return defaultResult(JSON.stringify({ success: false, error: `Plataforma headless no soportada: ${platform}` }));
          }
        } catch (error) {
          console.error(`[Pioneer] Error en get_pending_connection para ${platform}:`, error);
          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return defaultResult(JSON.stringify({ success: false, error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.', expired: true }), { shouldClearOAuthCookie: true });
          }
          throw error;
        }
      }

      case 'complete_connection': {
        const input = toolInput as {
          platform: string;
          selection_id: string;
          selection_name?: string;
          _linkedin_data?: { tempToken: string; userProfile: Record<string, unknown>; organizations: Array<{ id: string; urn: string; name: string }> };
        };

        const pending = pendingOAuthData;
        if (!pending) {
          return defaultResult(JSON.stringify({ success: false, error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.' }));
        }

        const { platform, profileId, tempToken, connectToken, userProfile } = pending;
        const { selection_id, selection_name } = input;
        console.log(`[Pioneer] complete_connection: ${platform}, selection: ${selection_id} (${selection_name})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos para guardar la selección de Facebook. El cliente debe intentar conectar de nuevo.' }));
              }
              let validatedSelectionId = selection_id;
              try {
                const fbPages = await getFacebookPages(profileId, tempToken, connectToken);
                const realPages = fbPages.pages;
                const exactMatch = realPages.find(p => p.id === selection_id);
                if (!exactMatch) {
                  console.warn(`[Pioneer] ⚠️ selection_id "${selection_id}" no coincide. Intentando auto-corrección...`);
                  if (selection_name) {
                    const nameMatch = realPages.find(p => p.name.toLowerCase() === selection_name.toLowerCase());
                    if (nameMatch) { validatedSelectionId = nameMatch.id; console.log(`[Pioneer] CORRECCIÓN FB por nombre: "${nameMatch.id}"`); }
                  }
                  if (validatedSelectionId === selection_id && realPages.length === 1) {
                    validatedSelectionId = realPages[0].id;
                    console.log(`[Pioneer] CORRECCIÓN FB (única page): "${realPages[0].id}"`);
                  }
                }
              } catch (fetchErr) {
                console.warn('[Pioneer] No se pudieron re-fetch pages para validación:', fetchErr);
              }
              await saveFacebookPage(profileId, validatedSelectionId, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({ success: true, platform, message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`, connected: true }), { shouldClearOAuthCookie: true });
            }

            case 'linkedin': {
              const liData = input._linkedin_data || (linkedInCachedData as { tempToken: string; userProfile: Record<string, unknown>; organizations: Array<{ id: string; urn: string; name: string }> } | null);
              if (!liData || !connectToken) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos de LinkedIn para guardar la selección.' }));
              }
              const isPersonal = selection_id === 'personal';
              const selectedOrg = isPersonal ? undefined : liData.organizations.find(o => o.id === selection_id);
              await saveLinkedInOrganization(profileId, liData.tempToken, liData.userProfile, isPersonal ? 'personal' : 'organization', connectToken, selectedOrg);
              return defaultResult(JSON.stringify({
                success: true, platform,
                message: isPersonal ? `LinkedIn conectado como cuenta personal.` : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
                connected: true,
              }), { shouldClearOAuthCookie: true });
            }

            case 'pinterest': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos para Pinterest.' }));
              }
              await savePinterestBoard(profileId, selection_id, selection_name || selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({ success: true, platform, message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`, connected: true }), { shouldClearOAuthCookie: true });
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos para Google Business.' }));
              }
              await saveGoogleBusinessLocation(profileId, selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({ success: true, platform, message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`, connected: true }), { shouldClearOAuthCookie: true });
            }

            case 'snapchat': {
              if (!tempToken || !connectToken || !userProfile) {
                return defaultResult(JSON.stringify({ success: false, error: 'Faltan datos para Snapchat.' }));
              }
              await saveSnapchatProfile(profileId, selection_id, tempToken, userProfile, connectToken);
              return defaultResult(JSON.stringify({ success: true, platform, message: 'Perfil público de Snapchat conectado exitosamente.', connected: true }), { shouldClearOAuthCookie: true });
            }

            default:
              return defaultResult(JSON.stringify({ success: false, error: `Plataforma no soportada: ${platform}` }));
          }
        } catch (error) {
          console.error(`[Pioneer] Error completando conexión para ${platform}:`, error);
          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return defaultResult(JSON.stringify({ success: false, error: 'Los tokens de autorización expiraron.', expired: true }), { shouldClearOAuthCookie: true });
          }
          throw error;
        }
      }

      default:
        return defaultResult(JSON.stringify({ error: `Tool desconocida: ${toolName}` }));
    }
  } catch (error) {
    console.error(`[Pioneer] Error ejecutando tool ${toolName}:`, error);
    return defaultResult(JSON.stringify({ success: false, error: `Error ejecutando ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}` }));
  }
}
