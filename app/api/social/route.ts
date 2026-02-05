import { NextRequest, NextResponse } from 'next/server';
import {
  createPost,
  listAccounts,
  listProfiles,
  createProfile,
  getConnectUrl,
  getNextOptimalTime,
  PR_TIMEZONE,
  LateApiError,
} from '@/lib/late-client';
import type { PublishRequest, LatePlatformTarget } from '@/lib/types';

// === POST /api/social — Publicar o programar un post ===
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'publish':
        return handlePublish(body);
      case 'schedule':
        return handleSchedule(body);
      case 'list-accounts':
        return handleListAccounts();
      case 'list-profiles':
        return handleListProfiles();
      case 'create-profile':
        return handleCreateProfile(body);
      case 'connect':
        return handleConnect(body);
      default:
        return NextResponse.json(
          { error: `Acción no reconocida: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error en API social:', error);

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

// --- Publicar inmediatamente ---
async function handlePublish(body: {
  content: string;
  platforms: LatePlatformTarget[];
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}) {
  if (!body.content || !body.platforms?.length) {
    return NextResponse.json(
      { error: 'Se requiere content y platforms' },
      { status: 400 }
    );
  }

  const data: PublishRequest = {
    content: body.content,
    platforms: body.platforms,
    publishNow: true,
  };

  if (body.mediaItems?.length) {
    data.mediaItems = body.mediaItems;
  }

  const result = await createPost(data);

  return NextResponse.json({
    success: true,
    message: 'Post publicado exitosamente',
    post: result.post,
  });
}

// --- Programar para horario óptimo ---
async function handleSchedule(body: {
  content: string;
  platforms: LatePlatformTarget[];
  scheduledFor?: string;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}) {
  if (!body.content || !body.platforms?.length) {
    return NextResponse.json(
      { error: 'Se requiere content y platforms' },
      { status: 400 }
    );
  }

  // Usar horario proporcionado o calcular el próximo óptimo
  const scheduledFor = body.scheduledFor || getNextOptimalTime();

  const data: PublishRequest = {
    content: body.content,
    platforms: body.platforms,
    scheduledFor,
    timezone: PR_TIMEZONE,
  };

  if (body.mediaItems?.length) {
    data.mediaItems = body.mediaItems;
  }

  const result = await createPost(data);

  return NextResponse.json({
    success: true,
    message: `Post programado para ${scheduledFor}`,
    post: result.post,
    scheduledFor,
    timezone: PR_TIMEZONE,
  });
}

// --- Listar cuentas conectadas ---
async function handleListAccounts() {
  const result = await listAccounts();

  return NextResponse.json({
    success: true,
    accounts: result.accounts,
    count: result.accounts.length,
  });
}

// --- Listar perfiles ---
async function handleListProfiles() {
  const result = await listProfiles();

  return NextResponse.json({
    success: true,
    profiles: result.profiles,
  });
}

// --- Crear perfil ---
async function handleCreateProfile(body: {
  name: string;
  description?: string;
}) {
  if (!body.name) {
    return NextResponse.json(
      { error: 'Se requiere name para crear un perfil' },
      { status: 400 }
    );
  }

  const result = await createProfile(body.name, body.description);

  return NextResponse.json({
    success: true,
    message: 'Perfil creado exitosamente',
    profile: result.profile,
  });
}

// --- Obtener URL de conexión OAuth ---
async function handleConnect(body: {
  platform: string;
  profileId: string;
}) {
  if (!body.platform || !body.profileId) {
    return NextResponse.json(
      { error: 'Se requiere platform y profileId' },
      { status: 400 }
    );
  }

  const validPlatforms = [
    'twitter', 'instagram', 'facebook', 'linkedin', 'tiktok',
    'youtube', 'pinterest', 'reddit', 'bluesky', 'threads',
    'googlebusiness', 'telegram', 'snapchat',
  ];

  if (!validPlatforms.includes(body.platform)) {
    return NextResponse.json(
      { error: `Plataforma no válida: ${body.platform}` },
      { status: 400 }
    );
  }

  const result = await getConnectUrl(
    body.platform as LatePlatformTarget['platform'],
    body.profileId
  );

  return NextResponse.json({
    success: true,
    authUrl: result.authUrl,
    platform: body.platform,
  });
}
