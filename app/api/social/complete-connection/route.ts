import { NextRequest, NextResponse } from 'next/server';
import { getOAuthCookie, createResponseWithClearedCookie } from '@/lib/oauth-cookie';
import {
  getFacebookPages,
  getLinkedInPendingData,
  saveLinkedInOrganization,
  saveFacebookPage,
  getPinterestBoards,
  savePinterestBoard,
  getGoogleBusinessLocations,
  saveGoogleBusinessLocation,
  saveSnapchatProfile,
  LateApiError,
} from '@/lib/late-client';

// === POST /api/social/complete-connection ===
// Llamada desde executeTool() en chat/route.ts cuando Pioneer usa la tool complete_connection.
//
// Dos acciones:
// 1. action: "get-options" → Lee cookie, llama a Late.dev para obtener opciones (páginas, orgs, etc.)
// 2. action: "save-selection" → Guarda la selección del cliente en Late.dev, borra cookie

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'get-options':
        return handleGetOptions(request);
      case 'save-selection':
        return handleSaveSelection(request, body);
      default:
        return NextResponse.json(
          { error: `Acción no reconocida: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[Pioneer] Error en complete-connection:', error);

    if (error instanceof LateApiError) {
      return NextResponse.json(
        {
          error: `Error de Late.dev: ${error.message}`,
          status: error.status,
          details: error.body,
        },
        { status: error.status >= 500 ? 502 : error.status }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

// --- Acción 1: Obtener opciones disponibles ---
async function handleGetOptions(request: NextRequest) {
  // Leer cookie con tokens OAuth pendientes
  const pending = getOAuthCookie(request);

  if (!pending) {
    return NextResponse.json({
      success: false,
      error: 'No hay conexión pendiente. La sesión de autorización pudo haber expirado (10 minutos). El cliente debe intentar conectar la plataforma de nuevo.',
    });
  }

  const { platform, step, profileId, tempToken, connectToken, pendingDataToken } = pending;

  console.log(`[Pioneer] Obteniendo opciones para ${platform} (step: ${step})`);

  try {
    switch (platform) {
      case 'facebook':
      case 'instagram': {
        // Facebook e Instagram usan el mismo flujo (select_page)
        if (!tempToken || !connectToken) {
          return NextResponse.json({
            success: false,
            error: 'Faltan tokens para obtener páginas de Facebook. Intente conectar de nuevo.',
          });
        }
        const result = await getFacebookPages(profileId, tempToken, connectToken);
        return NextResponse.json({
          success: true,
          platform,
          step,
          options_type: 'pages',
          options: result.pages.map(p => ({
            id: p.id,
            name: p.name,
            username: p.username || '',
            category: p.category || '',
          })),
          message: `Se encontraron ${result.pages.length} página(s) de Facebook. El cliente debe seleccionar una.`,
        });
      }

      case 'linkedin': {
        // LinkedIn usa pendingDataToken (endpoint de un solo uso)
        if (!pendingDataToken) {
          // Si no hay pendingDataToken, la cuenta se conectó directamente como personal
          return NextResponse.json({
            success: true,
            platform,
            step: 'direct_connect',
            options_type: 'none',
            options: [],
            message: 'La cuenta de LinkedIn se conectó directamente como cuenta personal (sin organizaciones disponibles).',
          });
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
          return createResponseWithClearedCookie({
            success: true,
            platform,
            step: 'auto_connected',
            options_type: 'none',
            options: [],
            message: `LinkedIn conectado como cuenta personal de ${linkedInData.userProfile.displayName}. No se encontraron organizaciones.`,
            connected: true,
          });
        }

        // Tiene organizaciones → mostrar opciones al cliente
        // ⚠️ IMPORTANTE: Guardamos los datos de LinkedIn en la respuesta porque
        // el pendingDataToken ya fue consumido (es de un solo uso).
        // El frontend/tool debe pasar estos datos de vuelta en save-selection.
        return NextResponse.json({
          success: true,
          platform,
          step,
          options_type: 'organizations',
          options: [
            { id: 'personal', name: `Cuenta personal (${linkedInData.userProfile.displayName})`, type: 'personal' },
            ...linkedInData.organizations.map(org => ({
              id: org.id,
              name: org.name,
              urn: org.urn,
              type: 'organization',
            })),
          ],
          // Datos necesarios para save-selection (porque pendingDataToken ya fue consumido)
          _linkedin_data: {
            tempToken: linkedInData.tempToken,
            userProfile: linkedInData.userProfile,
            organizations: linkedInData.organizations,
          },
          message: `Se encontraron ${linkedInData.organizations.length} organización(es) de LinkedIn. El cliente puede elegir su cuenta personal o una organización.`,
        });
      }

      case 'pinterest': {
        if (!tempToken || !connectToken) {
          return NextResponse.json({
            success: false,
            error: 'Faltan tokens para obtener boards de Pinterest. Intente conectar de nuevo.',
          });
        }
        const result = await getPinterestBoards(profileId, tempToken, connectToken);
        return NextResponse.json({
          success: true,
          platform,
          step,
          options_type: 'boards',
          options: result.boards.map(b => ({
            id: b.id,
            name: b.name,
            description: b.description || '',
          })),
          message: `Se encontraron ${result.boards.length} board(s) de Pinterest. El cliente debe seleccionar uno.`,
        });
      }

      case 'googlebusiness': {
        if (!tempToken || !connectToken) {
          return NextResponse.json({
            success: false,
            error: 'Faltan tokens para obtener ubicaciones de Google Business. Intente conectar de nuevo.',
          });
        }
        const result = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
        return NextResponse.json({
          success: true,
          platform,
          step,
          options_type: 'locations',
          options: result.locations.map(l => ({
            id: l.id,
            name: l.name,
            address: l.address || '',
          })),
          message: `Se encontraron ${result.locations.length} ubicación(es) de Google Business. El cliente debe seleccionar una.`,
        });
      }

      case 'snapchat': {
        // Snapchat pasa los perfiles públicos directamente en el callback
        const publicProfiles = pending.publicProfiles || [];
        return NextResponse.json({
          success: true,
          platform,
          step,
          options_type: 'public_profiles',
          options: Array.isArray(publicProfiles) ? publicProfiles : [],
          message: `Se encontraron ${Array.isArray(publicProfiles) ? publicProfiles.length : 0} perfil(es) público(s) de Snapchat. El cliente debe seleccionar uno.`,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Plataforma headless no soportada: ${platform}`,
        });
    }
  } catch (error) {
    console.error(`[Pioneer] Error obteniendo opciones para ${platform}:`, error);

    if (error instanceof LateApiError) {
      // Si el token expiró o es inválido
      if (error.status === 401 || error.status === 403) {
        return NextResponse.json({
          success: false,
          error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
          expired: true,
        });
      }
    }

    throw error; // Re-throw para el handler general
  }
}

// --- Acción 2: Guardar selección del cliente ---
async function handleSaveSelection(request: NextRequest, body: {
  action: string;
  platform: string;
  selection_id: string;
  selection_name?: string;
  // LinkedIn-specific: datos que vinieron del get-options (porque pendingDataToken es one-time)
  _linkedin_data?: {
    tempToken: string;
    userProfile: Record<string, unknown>;
    organizations: Array<{ id: string; urn: string; name: string }>;
  };
}) {
  const pending = getOAuthCookie(request);

  if (!pending) {
    return NextResponse.json({
      success: false,
      error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.',
    });
  }

  const { platform, profileId, tempToken, connectToken, userProfile } = pending;
  const { selection_id, selection_name } = body;

  console.log(`[Pioneer] Guardando selección para ${platform}: ${selection_id} (${selection_name})`);

  try {
    switch (platform) {
      case 'facebook':
      case 'instagram': {
        if (!tempToken || !connectToken || !userProfile) {
          return NextResponse.json({
            success: false,
            error: 'Faltan datos para guardar la selección de Facebook. Intente conectar de nuevo.',
          });
        }
        await saveFacebookPage(profileId, selection_id, tempToken, userProfile, connectToken);
        return createResponseWithClearedCookie({
          success: true,
          platform,
          message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`,
          connected: true,
        });
      }

      case 'linkedin': {
        // LinkedIn: los datos vienen de _linkedin_data porque pendingDataToken es de un solo uso
        const linkedInData = body._linkedin_data;
        if (!linkedInData || !connectToken) {
          return NextResponse.json({
            success: false,
            error: 'Faltan datos de LinkedIn para guardar la selección. Intente conectar de nuevo.',
          });
        }

        const isPersonal = selection_id === 'personal';
        const selectedOrg = isPersonal
          ? undefined
          : linkedInData.organizations.find(o => o.id === selection_id);

        await saveLinkedInOrganization(
          profileId,
          linkedInData.tempToken,
          linkedInData.userProfile,
          isPersonal ? 'personal' : 'organization',
          connectToken,
          selectedOrg
        );

        return createResponseWithClearedCookie({
          success: true,
          platform,
          message: isPersonal
            ? `LinkedIn conectado como cuenta personal de ${linkedInData.userProfile.displayName || 'usuario'}.`
            : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
          connected: true,
        });
      }

      case 'pinterest': {
        if (!tempToken || !connectToken || !userProfile) {
          return NextResponse.json({
            success: false,
            error: 'Faltan datos para guardar la selección de Pinterest. Intente conectar de nuevo.',
          });
        }
        await savePinterestBoard(
          profileId,
          selection_id,
          selection_name || selection_id,
          tempToken,
          userProfile,
          connectToken
        );
        return createResponseWithClearedCookie({
          success: true,
          platform,
          message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`,
          connected: true,
        });
      }

      case 'googlebusiness': {
        if (!tempToken || !connectToken || !userProfile) {
          return NextResponse.json({
            success: false,
            error: 'Faltan datos para guardar la ubicación de Google Business. Intente conectar de nuevo.',
          });
        }
        await saveGoogleBusinessLocation(
          profileId,
          selection_id,
          tempToken,
          userProfile,
          connectToken
        );
        return createResponseWithClearedCookie({
          success: true,
          platform,
          message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`,
          connected: true,
        });
      }

      case 'snapchat': {
        if (!tempToken || !connectToken || !userProfile) {
          return NextResponse.json({
            success: false,
            error: 'Faltan datos para guardar el perfil de Snapchat. Intente conectar de nuevo.',
          });
        }
        await saveSnapchatProfile(
          profileId,
          selection_id,
          tempToken,
          userProfile,
          connectToken
        );
        return createResponseWithClearedCookie({
          success: true,
          platform,
          message: `Perfil público de Snapchat conectado exitosamente.`,
          connected: true,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Plataforma no soportada para guardar selección: ${platform}`,
        });
    }
  } catch (error) {
    console.error(`[Pioneer] Error guardando selección para ${platform}:`, error);

    if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({
        success: false,
        error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
        expired: true,
      });
    }

    throw error;
  }
}
