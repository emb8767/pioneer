// Cliente de Late.dev para Pioneer Agent
// Documentación: https://docs.getlate.dev

import type {
  LateProfile,
  LateAccount,
  LatePost,
  PublishRequest,
  Platform,
} from './types';

const LATE_BASE_URL = 'https://getlate.dev/api/v1';

function getApiKey(): string {
  const key = process.env.LATE_API_KEY;
  if (!key) {
    throw new Error('LATE_API_KEY no está configurada en .env.local');
  }
  return key;
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

async function lateRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${LATE_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new LateApiError(
      `Late.dev API error: ${response.status} ${response.statusText}`,
      response.status,
      errorBody
    );
  }

  return response.json();
}

// === Error personalizado ===

export class LateApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'LateApiError';
    this.status = status;
    this.body = body;
  }
}

// === PROFILES ===

export async function listProfiles(): Promise<{ profiles: LateProfile[] }> {
  return lateRequest('/profiles');
}

export async function createProfile(
  name: string,
  description?: string
): Promise<{ message: string; profile: LateProfile }> {
  return lateRequest('/profiles', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

// === ACCOUNTS ===

export async function listAccounts(): Promise<{ accounts: LateAccount[] }> {
  return lateRequest('/accounts');
}

// === OAUTH — CONNECT ===

// Plataformas que requieren selección adicional → headless automático
const HEADLESS_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'pinterest',
  'googlebusiness',
  'snapchat',
]);

/**
 * Determina si una plataforma usa OAuth headless.
 */
export function isHeadlessPlatform(platform: string): boolean {
  return HEADLESS_PLATFORMS.has(platform);
}

/**
 * Genera la URL de OAuth para conectar una cuenta de red social.
 * 
 * Automáticamente usa headless=true para plataformas que requieren
 * selección adicional (Facebook, Instagram, LinkedIn, Pinterest,
 * Google Business, Snapchat).
 * 
 * Standard mode: Late.dev redirige al callback con ?connected=platform
 * Headless mode: Late.dev redirige al callback con tokens temporales + step=select_*
 */
export async function getConnectUrl(
  platform: Platform,
  profileId: string,
  options?: { headless?: boolean }
): Promise<{ authUrl: string }> {
  const callbackUrl = `${getAppUrl()}/api/social/callback`;
  
  // Auto-detect headless para plataformas que lo requieren
  const useHeadless = options?.headless ?? HEADLESS_PLATFORMS.has(platform);
  
  let endpoint = `/connect/${platform}?profileId=${profileId}&redirect_url=${encodeURIComponent(callbackUrl)}`;
  
  if (useHeadless) {
    endpoint += '&headless=true';
  }
  
  return lateRequest(endpoint);
}

// Bluesky usa App Password en vez de OAuth
export async function connectBluesky(
  profileId: string,
  handle: string,
  appPassword: string
): Promise<LateAccount> {
  return lateRequest('/connect/bluesky/credentials', {
    method: 'POST',
    body: JSON.stringify({ profileId, handle, appPassword }),
  });
}

// ============================================================
// === HEADLESS OAUTH — Obtener opciones y guardar selección ===
// ============================================================

// --- Facebook: Obtener páginas disponibles ---

export interface FacebookPage {
  id: string;
  name: string;
  username?: string;
  access_token: string;
  category?: string;
  tasks?: string[];
}

export async function getFacebookPages(
  profileId: string,
  tempToken: string,
  connectToken: string
): Promise<{ pages: FacebookPage[] }> {
  return lateRequest(
    `/connect/facebook/select-page?profileId=${profileId}&tempToken=${encodeURIComponent(tempToken)}`,
    {
      headers: {
        'X-Connect-Token': connectToken,
      },
    }
  );
}

export async function saveFacebookPage(
  profileId: string,
  pageId: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  connectToken: string
): Promise<unknown> {
  return lateRequest('/connect/facebook/select-page', {
    method: 'POST',
    headers: {
      'X-Connect-Token': connectToken,
    },
    body: JSON.stringify({
      profileId,
      pageId,
      tempToken,
      userProfile,
    }),
  });
}

// --- LinkedIn: Obtener datos pendientes ---
// ⚠️ IMPORTANTE: Este endpoint es de UN SOLO USO — los datos se borran después de consultarlos.
// Expiran en 10 minutos.

export interface LinkedInPendingData {
  platform: string;
  profileId: string;
  tempToken: string;
  refreshToken?: string;
  expiresIn?: number;
  userProfile: {
    id: string;
    username: string;
    displayName: string;
    profilePicture?: string;
  };
  selectionType?: string;
  organizations?: Array<{
    id: string;
    urn: string;
    name: string;
  }>;
}

export async function getLinkedInPendingData(
  pendingDataToken: string
): Promise<LinkedInPendingData> {
  return lateRequest(`/connect/pending-data?token=${encodeURIComponent(pendingDataToken)}`);
}

export async function saveLinkedInOrganization(
  profileId: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  accountType: 'personal' | 'organization',
  connectToken: string,
  selectedOrganization?: { id: string; urn: string; name: string }
): Promise<unknown> {
  return lateRequest('/connect/linkedin/select-organization', {
    method: 'POST',
    headers: {
      'X-Connect-Token': connectToken,
    },
    body: JSON.stringify({
      profileId,
      tempToken,
      userProfile,
      accountType,
      ...(selectedOrganization && { selectedOrganization }),
    }),
  });
}

// --- Pinterest: Obtener boards ---

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  url?: string;
}

export async function getPinterestBoards(
  profileId: string,
  tempToken: string,
  connectToken: string
): Promise<{ boards: PinterestBoard[] }> {
  return lateRequest(
    `/connect/pinterest/select-board?profileId=${profileId}&tempToken=${encodeURIComponent(tempToken)}`,
    {
      headers: {
        'X-Connect-Token': connectToken,
      },
    }
  );
}

export async function savePinterestBoard(
  profileId: string,
  boardId: string,
  boardName: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  connectToken: string
): Promise<unknown> {
  return lateRequest('/connect/pinterest/select-board', {
    method: 'POST',
    headers: {
      'X-Connect-Token': connectToken,
    },
    body: JSON.stringify({
      profileId,
      boardId,
      boardName,
      tempToken,
      userProfile,
    }),
  });
}

// --- Google Business: Obtener ubicaciones ---

export interface GoogleBusinessLocation {
  id: string;
  name: string;
  address?: string;
}

export async function getGoogleBusinessLocations(
  profileId: string,
  tempToken: string,
  connectToken: string
): Promise<{ locations: GoogleBusinessLocation[] }> {
  return lateRequest(
    `/connect/googlebusiness/locations?profileId=${profileId}&tempToken=${encodeURIComponent(tempToken)}`,
    {
      headers: {
        'X-Connect-Token': connectToken,
      },
    }
  );
}

export async function saveGoogleBusinessLocation(
  profileId: string,
  locationId: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  connectToken: string
): Promise<unknown> {
  return lateRequest('/connect/googlebusiness/select-location', {
    method: 'POST',
    headers: {
      'X-Connect-Token': connectToken,
    },
    body: JSON.stringify({
      profileId,
      locationId,
      tempToken,
      userProfile,
    }),
  });
}

// --- Snapchat: Guardar selección de perfil público ---

export async function saveSnapchatProfile(
  profileId: string,
  publicProfileId: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  connectToken: string
): Promise<unknown> {
  return lateRequest('/connect/snapchat/select-profile', {
    method: 'POST',
    headers: {
      'X-Connect-Token': connectToken,
    },
    body: JSON.stringify({
      profileId,
      publicProfileId,
      tempToken,
      userProfile,
    }),
  });
}

// === POSTS ===

export async function createPost(
  data: PublishRequest
): Promise<{ message: string; post: LatePost }> {
  return lateRequest('/posts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listPosts(): Promise<{ posts: LatePost[] }> {
  return lateRequest('/posts');
}

export async function getPost(
  postId: string
): Promise<{ post: LatePost }> {
  return lateRequest(`/posts/${postId}`);
}

export async function updatePost(
  postId: string,
  data: Partial<PublishRequest>
): Promise<{ post: LatePost }> {
  return lateRequest(`/posts/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePost(
  postId: string
): Promise<{ message: string }> {
  return lateRequest(`/posts/${postId}`, {
    method: 'DELETE',
  });
}

// === HELPERS ===

/**
 * Calcula el próximo horario óptimo de publicación para Puerto Rico.
 * Lun-Vie: 12:00 PM o 7:00 PM
 * Sáb-Dom: 10:00 AM o 1:00 PM
 */
export function getNextOptimalTime(): string {
  const now = new Date();

  // Convertir a hora de Puerto Rico (UTC-4)
  const prOffset = -4 * 60;
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const prTime = new Date(utcTime + prOffset * 60000);

  const day = prTime.getDay(); // 0=Dom, 6=Sáb
  const hour = prTime.getHours();

  let targetHour: number;
  let daysToAdd = 0;

  if (day >= 1 && day <= 5) {
    // Lunes a Viernes
    if (hour < 12) {
      targetHour = 12;
    } else if (hour < 19) {
      targetHour = 19;
    } else {
      // Ya pasaron los horarios de hoy, programar para mañana
      daysToAdd = 1;
      targetHour = day === 5 ? 10 : 12; // Si es viernes, mañana es sábado
    }
  } else {
    // Sábado o Domingo
    if (hour < 10) {
      targetHour = 10;
    } else if (hour < 13) {
      targetHour = 13;
    } else {
      // Ya pasaron los horarios del fin de semana
      daysToAdd = day === 6 ? 2 : 1; // Saltar al lunes
      targetHour = 12;
    }
  }

  const target = new Date(prTime);
  target.setDate(target.getDate() + daysToAdd);
  target.setHours(targetHour, 0, 0, 0);

  // Formatear como ISO sin timezone (Late.dev usa el campo timezone separado)
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const dayStr = String(target.getDate()).padStart(2, '0');
  const hourStr = String(target.getHours()).padStart(2, '0');

  return `${year}-${month}-${dayStr}T${hourStr}:00:00`;
}

export const PR_TIMEZONE = 'America/Puerto_Rico';
