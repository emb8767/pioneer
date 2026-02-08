import { NextRequest, NextResponse } from 'next/server';
import { setOAuthCookie, type OAuthPendingData } from '@/lib/oauth-cookie';

// === GET /api/social/callback ===
// Este endpoint recibe las redirecciones OAuth de Late.dev después de que
// el usuario autoriza la conexión de una red social.
//
// Escenario 1 — Standard mode (plataformas sin selección adicional):
//   Late.dev redirige con: ?connected={platform}&profileId={id}&username={name}
//   → Mostrar página de éxito, redirigir al chat
//
// Escenario 2 — Headless mode (plataformas con selección adicional):
//   Late.dev redirige con tokens temporales + step=select_page|select_organization|etc.
//   → Guardar tokens en cookie httpOnly encriptada → redirigir al chat con query param
//   → El chat envía mensaje automático → Pioneer usa tool complete_connection

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // --- Escenario 1: Conexión exitosa directa (standard mode) ---
  const connected = searchParams.get('connected');
  if (connected) {
    const profileId = searchParams.get('profileId') || '';
    const username = searchParams.get('username') || '';

    const html = buildSuccessPage(connected, username, profileId);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- Escenario 2: Headless mode (requiere selección adicional) ---
  const step = searchParams.get('step');
  if (step) {
    const platform = searchParams.get('platform') || '';
    const profileId = searchParams.get('profileId') || '';
    const connectToken = searchParams.get('connect_token') || '';

    // Construir datos para la cookie según la plataforma
    const pendingData: OAuthPendingData = {
      platform,
      step,
      profileId,
      connectToken,
      timestamp: Date.now(),
    };

    // === LinkedIn usa pendingDataToken (datos se obtienen vía API, no por URL) ===
    if (platform === 'linkedin') {
      const pendingDataToken = searchParams.get('pendingDataToken') || '';
      pendingData.pendingDataToken = pendingDataToken;
    } else {
      // === Otras plataformas headless pasan tempToken y userProfile por URL ===
      const tempToken = searchParams.get('tempToken') || '';
      const userProfileRaw = searchParams.get('userProfile') || '';

      pendingData.tempToken = tempToken;

      // userProfile viene como JSON URL-encoded
      if (userProfileRaw) {
        try {
          pendingData.userProfile = JSON.parse(decodeURIComponent(userProfileRaw));
        } catch {
          // Si no se puede parsear, guardamos como string
          pendingData.userProfile = { raw: userProfileRaw };
        }
      }

      // Snapchat también pasa publicProfiles
      if (platform === 'snapchat') {
        const publicProfilesRaw = searchParams.get('publicProfiles') || '';
        if (publicProfilesRaw) {
          try {
            pendingData.publicProfiles = JSON.parse(decodeURIComponent(publicProfilesRaw));
          } catch {
            pendingData.publicProfiles = [];
          }
        }
      }
    }

    // Guardar tokens en cookie httpOnly encriptada
    const platformName = getPlatformDisplayName(platform);
    const html = buildHeadlessRedirectPage(platformName, step);

    const response = new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    setOAuthCookie(response, pendingData);

    return response;
  }

  // --- Escenario 3: Error ---
  const error = searchParams.get('error');
  if (error) {
    const html = buildErrorPage(error);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Fallback
  const html = buildErrorPage('No se recibieron parámetros de conexión válidos.');
  return new NextResponse(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// === HTML Builders ===

function buildSuccessPage(platform: string, username: string, profileId: string): string {
  const platformName = getPlatformDisplayName(platform);
  const displayUsername = decodeURIComponent(username);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pioneer - Cuenta Conectada</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #1f2937;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
    .platform { color: #2563eb; font-weight: 600; }
    .username { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    .message {
      color: #374151;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      padding: 12px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
      transition: background 0.2s;
    }
    .btn:hover { background: #1d4ed8; }
    .auto-redirect { color: #9ca3af; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>¡Cuenta Conectada!</h1>
    <p class="username">
      <span class="platform">${platformName}</span>${displayUsername ? ` — ${displayUsername}` : ''}
    </p>
    <p class="message">
      Su cuenta de ${platformName} ha sido conectada exitosamente a Pioneer.
      Ya puede regresar al chat para continuar con su plan de marketing.
    </p>
    <a href="/chat" class="btn">Regresar al Chat</a>
    <p class="auto-redirect">Será redirigido automáticamente en 5 segundos...</p>
  </div>
  <script>
    setTimeout(function() { window.location.href = '/chat'; }, 5000);
  </script>
</body>
</html>`;
}

function buildHeadlessRedirectPage(platformName: string, step: string): string {
  // Traducir el step a texto amigable
  const stepText: Record<string, string> = {
    select_page: 'seleccionar su página',
    select_organization: 'seleccionar su organización',
    select_board: 'seleccionar su board',
    select_location: 'seleccionar su ubicación',
    select_public_profile: 'seleccionar su perfil público',
  };
  const stepDescription = stepText[step] || 'completar la configuración';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pioneer - Completar Conexión</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #1f2937;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 16px; }
    .message {
      color: #374151;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .highlight {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      color: #1e40af;
      font-size: 14px;
    }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      padding: 12px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
      transition: background 0.2s;
    }
    .btn:hover { background: #1d4ed8; }
    .auto-redirect { color: #9ca3af; font-size: 12px; margin-top: 16px; }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #93c5fd;
      border-top-color: #2563eb;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔗</div>
    <h1>¡Autorización Exitosa!</h1>
    <p class="message">
      La autorización de ${platformName} fue exitosa. Solo falta ${stepDescription}
      para completar la conexión.
    </p>
    <div class="highlight">
      <span class="spinner"></span>
      Pioneer le guiará para completar este paso en el chat.
    </div>
    <a href="/chat?pending_connection=${encodeURIComponent(platformName.toLowerCase())}" class="btn">Completar en el Chat</a>
    <p class="auto-redirect">Será redirigido automáticamente en 3 segundos...</p>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = '/chat?pending_connection=${encodeURIComponent(platformName.toLowerCase())}';
    }, 3000);
  </script>
</body>
</html>`;
}

function buildErrorPage(error: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pioneer - Error de Conexión</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #1f2937;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 16px; color: #dc2626; }
    .message {
      color: #374151;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      padding: 12px 32px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
    }
    .btn:hover { background: #1d4ed8; }
    .support { color: #9ca3af; font-size: 13px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Error de Conexión</h1>
    <p class="message">
      Hubo un problema al conectar su cuenta de red social.
      Por favor regrese al chat e intente de nuevo.
    </p>
    <a href="/chat" class="btn">Regresar al Chat</a>
    <p class="support">Si el problema persiste, contacte a info@pioneeragt.com</p>
  </div>
</body>
</html>`;
}

function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    twitter: 'Twitter/X',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    threads: 'Threads',
    reddit: 'Reddit',
    pinterest: 'Pinterest',
    bluesky: 'Bluesky',
    googlebusiness: 'Google Business',
    telegram: 'Telegram',
    snapchat: 'Snapchat',
  };
  return names[platform] || platform;
}
