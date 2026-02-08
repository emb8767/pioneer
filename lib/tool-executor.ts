// Ejecutor de tools para Pioneer Agent
// Llamadas directas a APIs (sin fetch HTTP — regla Vercel serverless)

import {
  listAccounts,
  getConnectUrl,
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
  // Queue functions
  setupQueueSlots,
  getQueueNextSlot,
} from '@/lib/late-client';
import { generateContent } from '@/lib/content-generator';
import { generateImage } from '@/lib/replicate-client';
import { validateAndPreparePublish, publishWithRetry } from '@/lib/publish-validator';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import type { Platform } from '@/lib/types';

// === TIPO DE RETORNO DE executeTool ===
export interface ToolResult {
  result: string;
  publishPostCalled: boolean;
  shouldClearOAuthCookie: boolean;
  linkedInDataToCache: Record<string, unknown> | null;
  connectionOptionsToCache: Array<{ id: string; name: string }> | null;
}

// === EJECUTAR TOOLS — LLAMADAS DIRECTAS (sin fetch HTTP) ===

export async function executeTool(
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
): Promise<ToolResult> {
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

        // === CARRUSEL: Generación paralela (Promise.all) ===
        if (imageCount > 1) {
          console.log(`[Pioneer] Generando carrusel de ${imageCount} imágenes (paralelo)`);

          const allImages: string[] = [];
          let totalCostReal = 0;
          let totalCostClient = 0;
          let anyRegenerated = false;
          const errors: string[] = [];

          const imagePromises = Array.from({ length: imageCount }, (_, i) => {
            console.log(`[Pioneer] Lanzando generación de imagen ${i + 1}/${imageCount}...`);
            return generateImage({
              prompt: input.prompt,
              model: (input.model as 'schnell' | 'pro') || 'schnell',
              aspect_ratio: (input.aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1',
              num_outputs: 1,
            }).catch(imgError => {
              console.error(`[Pioneer] Error en imagen ${i + 1}:`, imgError);
              return { success: false, error: imgError instanceof Error ? imgError.message : 'Error desconocido' } as { success: false; error: string };
            });
          });

          const results = await Promise.all(imagePromises);

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.success && 'images' in result && result.images && result.images.length > 0) {
              allImages.push(...result.images);
              totalCostReal += result.cost_real;
              totalCostClient += result.cost_client;
              if (result.regenerated) anyRegenerated = true;
            } else {
              const errorMsg = 'error' in result ? result.error : 'Error desconocido';
              errors.push(`Imagen ${i + 1}: ${errorMsg}`);
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
          use_queue?: boolean;
          queue_profile_id?: string;
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

          const wasAutoRescheduled = 'autoRescheduled' in result && result.autoRescheduled;
          const rescheduledFor = 'rescheduledFor' in result ? result.rescheduledFor : undefined;

          let successMessage: string;
          if (wasAutoRescheduled && rescheduledFor) {
            successMessage = `La plataforma indicó "posting too fast". El post fue auto-reprogramado para ${rescheduledFor} (en ~30 minutos). No se requiere acción del cliente.`;
          } else if (validation.data.queuedFromProfile) {
            successMessage = `Post agregado a la cola de publicación. Se publicará automáticamente en el próximo horario disponible.`;
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
              ...(validation.data.queuedFromProfile && {
                queued: true,
                queue_profile_id: validation.data.queuedFromProfile,
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

          return {
            result: JSON.stringify({
              success: true,
              message: `Cola de publicación configurada: ${slotDescriptions.join(', ')}.${nextSlotInfo}`,
              slots: formattedSlots,
              timezone: PR_TIMEZONE,
              profile_id: profileId,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        } catch (error) {
          console.error('[Pioneer] Error configurando queue:', error);
          const errorMessage = error instanceof LateApiError
            ? `Error de Late.dev (HTTP ${error.status}): ${error.body}`
            : error instanceof Error ? error.message : 'Error desconocido';

          return {
            result: JSON.stringify({
              success: false,
              error: `Error configurando cola de publicación: ${errorMessage}`,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }
      }

      // ============================================================
      // === TOOLS: OAuth Headless ===
      // ============================================================

      case 'get_pending_connection': {
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
                  message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente para que elija una.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: fbOptions,
              };
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Falta pendingDataToken para LinkedIn. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const liResult = await getLinkedInPendingData(pendingDataToken);
              const liOptions: Array<{ id: string; name: string }> = [
                { id: 'personal', name: `Cuenta personal de ${liResult.userProfile.displayName}` },
              ];
              if (liResult.organizations) {
                for (const org of liResult.organizations) {
                  liOptions.push({ id: org.id, name: org.name });
                }
              }
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'accounts',
                  options: liOptions,
                  message: `Se encontraron ${liOptions.length} opción(es) de LinkedIn. Muestre las opciones al cliente para que elija una.`,
                  _linkedin_data: {
                    tempToken: liResult.tempToken,
                    userProfile: liResult.userProfile,
                    organizations: liResult.organizations || [],
                  },
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: {
                  tempToken: liResult.tempToken,
                  userProfile: liResult.userProfile,
                  organizations: liResult.organizations || [],
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
                  message: `Se encontraron ${pinResult.boards.length} board(s) de Pinterest. Muestre las opciones al cliente para que elija uno.`,
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
                  message: `Se encontraron ${gbResult.locations.length} ubicación(es) de Google Business. Muestre las opciones al cliente.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: gbOptions,
              };
            }

            case 'snapchat': {
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
