import { NextRequest, NextResponse } from 'next/server';

// === GET /api/social/callback ===
// Este endpoint recibe las redirecciones OAuth de Late.dev despues de que
// el usuario autoriza la conexion de una red social.
//
// Standard mode (sin headless):
//   Late.dev maneja la seleccion de pagina/organizacion y redirige aqui con:
//   ?connected={platform}&profileId={id}&username={name}
//
// Headless mode (futuro):
//   Late.dev redirige aqui con tokens temporales y step=select_page|select_organization|etc.
//   Pioneer construye su propia UI de seleccion.

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // --- Escenario 1: Conexion exitosa (standard mode) ---
  // Late.dev ya completo todo el flujo y redirige con ?connected=...
  const connected = searchParams.get('connected');
  if (connected) {
    const profileId = searchParams.get('profileId') || '';
    const username = searchParams.get('username') || '';

    // Construir pagina de exito que redirige al chat
    const html = buildSuccessPage(connected, username, profileId);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- Escenario 2: Headless mode (futuro) ---
  // Late.dev redirige con tokens temporales para que Pioneer maneje la seleccion
  const step = searchParams.get('step');
  if (step) {
    const platform = searchParams.get('platform') || '';
    const profileId = searchParams.get('profileId') || '';

    // Por ahora, mostrar pagina informativa
    // En el futuro, esto manejara la seleccion de pagina/organizacion/board/location
    const html = buildHeadlessPage(platform, step, profileId);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- Escenario 3: Error o parametros faltantes ---
  const error = searchParams.get('error');
  if (error) {
    const html = buildErrorPage(error);
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Fallback: sin parametros reconocidos
  const html = buildErrorPage('No se recibieron parametros de conexion validos.');
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
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .platform {
      color: #2563eb;
      font-weight: 600;
    }
    .username {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 24px;
    }
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
    .btn:hover {
      background: #1d4ed8;
    }
    .auto-redirect {
      color: #9ca3af;
      font-size: 12px;
      margin-top: 16px;
    }
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
    <p class="auto-redirect">Sera redirigido automaticamente en 5 segundos...</p>
  </div>
  <script>
    // Auto-redirect al chat despues de 5 segundos
    setTimeout(function() {
      window.location.href = '/chat';
    }, 5000);
  </script>
</body>
</html>`;
}

function buildHeadlessPage(platform: string, step: string, profileId: string): string {
  const platformName = getPlatformDisplayName(platform);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pioneer - Completar Conexion</title>
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
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔗</div>
    <h1>Conexion en Progreso</h1>
    <p class="message">
      La autorizacion de ${platformName} fue exitosa. Se necesita un paso adicional
      para completar la conexion (${step.replace('select_', 'seleccionar ')}).
      <br><br>
      Por favor regrese al chat de Pioneer para completar el proceso.
    </p>
    <a href="/chat" class="btn">Regresar al Chat</a>
  </div>
</body>
</html>`;
}

function buildErrorPage(error: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pioneer - Error de Conexion</title>
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
    .support {
      color: #9ca3af;
      font-size: 13px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Error de Conexion</h1>
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
