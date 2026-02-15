// Cliente de Late.dev para Pioneer Agent
// Documentación: https://docs.getlate.dev
//
// === CAMBIOS Draft-First ===
// - createDraftPost(): POST /v1/posts con isDraft: true
// - activateDraft(): PUT /v1/posts/{id} para cambiar draft → scheduled/publishNow/queued
// - updatePost(): corregido de PATCH a PUT (según docs Late.dev)
// - Detección nativa de duplicados via HTTP 409

import type {
  LateProfile,
  LateAccount,
  LatePost,
  PublishRequest,
  Platform,
  QueueSlot,
  QueueNextSlotResponse,
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
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
    throw new LateApiError(
      `Late.dev API error: ${response.status} ${response.statusText}`,
      response.status,
      errorBody,
      retryAfterMs
    );
  }

  return response.json();
}

// === Error personalizado ===

export class LateApiError extends Error {
  status: number;
  body: string;
  retryAfterMs: number | null;

  constructor(message: string, status: number, body: string, retryAfterMs?: number | null) {
    super(message);
    this.name = 'LateApiError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs || null;
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

const HEADLESS_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'pinterest',
  'googlebusiness',
  'snapchat',
]);

export function isHeadlessPlatform(platform: string): boolean {
  return HEADLESS_PLATFORMS.has(platform);
}

export async function getConnectUrl(
  platform: Platform,
  profileId: string,
  options?: { headless?: boolean }
): Promise<{ authUrl: string }> {
  const callbackUrl = `${getAppUrl()}/api/social/callback`;
  const useHeadless = options?.headless ?? HEADLESS_PLATFORMS.has(platform);
  let endpoint = `/connect/${platform}?profileId=${profileId}&redirect_url=${encodeURIComponent(callbackUrl)}`;
  if (useHeadless) {
    endpoint += '&headless=true';
  }
  return lateRequest(endpoint);
}

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
    { headers: { 'X-Connect-Token': connectToken } }
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
    headers: { 'X-Connect-Token': connectToken },
    body: JSON.stringify({ profileId, pageId, tempToken, userProfile }),
  });
}

// --- LinkedIn ---
// ⚠️ pendingDataToken es de UN SOLO USO — expira en 10 minutos.

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
  organizations?: Array<{ id: string; urn: string; name: string }>;
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
    headers: { 'X-Connect-Token': connectToken },
    body: JSON.stringify({
      profileId, tempToken, userProfile, accountType,
      ...(selectedOrganization && { selectedOrganization }),
    }),
  });
}

// --- Pinterest ---

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
    { headers: { 'X-Connect-Token': connectToken } }
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
    headers: { 'X-Connect-Token': connectToken },
    body: JSON.stringify({ profileId, boardId, boardName, tempToken, userProfile }),
  });
}

// --- Google Business ---

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
    { headers: { 'X-Connect-Token': connectToken } }
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
    headers: { 'X-Connect-Token': connectToken },
    body: JSON.stringify({ profileId, locationId, tempToken, userProfile }),
  });
}

// --- Snapchat ---

export async function saveSnapchatProfile(
  profileId: string,
  publicProfileId: string,
  tempToken: string,
  userProfile: Record<string, unknown>,
  connectToken: string
): Promise<unknown> {
  return lateRequest('/connect/snapchat/select-profile', {
    method: 'POST',
    headers: { 'X-Connect-Token': connectToken },
    body: JSON.stringify({ profileId, publicProfileId, tempToken, userProfile }),
  });
}

// === POSTS ===

/**
 * Crea un post directamente (scheduled, publishNow, o queued).
 * ⚠️ Para el flujo principal, usar createDraftPost() + activateDraft().
 * Se mantiene por compatibilidad pero el flujo Draft-First es preferido.
 */
export async function createPost(
  data: PublishRequest
): Promise<{ message: string; post: LatePost }> {
  return lateRequest('/posts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================
// === DRAFT-FIRST FLOW ===
// ============================================================
// Docs: https://docs.getlate.dev/core/posts
//
// Elimina duplicados por diseño:
// 1. createDraftPost() → POST /v1/posts { isDraft: true } → retorna draft._id
// 2. Cliente ve contenido + imagen y aprueba
// 3. activateDraft() → PUT /v1/posts/{draft_id} → scheduled/publishNow/queued
//
// Si Claude intenta publicar de nuevo, PUT al mismo draft_id.
// No se crea post nuevo. Si draft ya fue activado, Late.dev devuelve error claro.

export interface DraftPostData {
  content: string;
  platforms: Array<{ platform: string; accountId: string }>;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
  timezone?: string;
}

export async function createDraftPost(
  data: DraftPostData
): Promise<{ message: string; post: LatePost }> {
  return lateRequest('/posts', {
    method: 'POST',
    body: JSON.stringify({
      content: data.content,
      platforms: data.platforms,
      isDraft: true,
      timezone: data.timezone || PR_TIMEZONE,
      ...(data.mediaItems && data.mediaItems.length > 0 && {
        mediaItems: data.mediaItems,
      }),
    }),
  });
}

export interface ActivateDraftData {
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  queuedFromProfile?: string;
  queueId?: string;
  content?: string;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}

export async function activateDraft(
  postId: string,
  data: ActivateDraftData
): Promise<{ message: string; post: LatePost }> {
  // CRITICAL: isDraft: false tells Late.dev to transition from draft → scheduled/published.
  // Without this, the PUT updates fields but keeps the post as a draft.
  const result = await lateRequest<{ message: string; post: LatePost }>(`/posts/${postId}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...data,
      isDraft: false,
    }),
  });

  // Validate that the post actually transitioned out of draft status
  if (result.post?.status === 'draft') {
    console.warn(`[Pioneer] ⚠️ activateDraft: post ${postId} still has status=draft after PUT. Data sent:`, JSON.stringify(data));
  } else {
    console.log(`[Pioneer] activateDraft OK: post ${postId} status=${result.post?.status}`);
  }

  return result;
}

export async function listPosts(): Promise<{ posts: LatePost[] }> {
  return lateRequest('/posts');
}

export async function getPost(
  postId: string
): Promise<{ post: LatePost }> {
  return lateRequest(`/posts/${postId}`);
}

/**
 * Actualiza un post existente.
 * PUT /v1/posts/{postId} — solo draft, scheduled, failed, partial pueden editarse.
 */
export async function updatePost(
  postId: string,
  data: Partial<PublishRequest>
): Promise<{ post: LatePost }> {
  return lateRequest(`/posts/${postId}`, {
    method: 'PUT', // Corregido: Late.dev usa PUT, no PATCH
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

// === QUEUE ===

export async function setupQueueSlots(
  profileId: string,
  timezone: string,
  slots: QueueSlot[],
  active: boolean = true
): Promise<unknown> {
  return lateRequest('/queue/slots', {
    method: 'PUT',
    body: JSON.stringify({ profileId, timezone, slots, active }),
  });
}

export async function getQueueNextSlot(
  profileId: string
): Promise<QueueNextSlotResponse> {
  return lateRequest(`/queue/next-slot?profileId=${profileId}`);
}

export async function getQueueSlots(
  profileId: string
): Promise<unknown> {
  return lateRequest(`/queue/slots?profileId=${profileId}`);
}

// === HELPERS ===

export function getNextOptimalTime(): string {
  const prFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Puerto_Rico',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = prFormatter.formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';

  const year = parseInt(get('year'));
  const month = parseInt(get('month'));
  const dayNum = parseInt(get('day'));
  const hour = parseInt(get('hour'));
  const weekdayStr = get('weekday');

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const day = weekdayMap[weekdayStr] ?? 0;

  let targetHour: number;
  let daysToAdd = 0;

  if (day >= 1 && day <= 5) {
    if (hour < 12) {
      targetHour = 12;
    } else if (hour < 19) {
      targetHour = 19;
    } else {
      daysToAdd = 1;
      targetHour = day === 5 ? 10 : 12;
    }
  } else {
    if (hour < 10) {
      targetHour = 10;
    } else if (hour < 13) {
      targetHour = 13;
    } else {
      daysToAdd = day === 6 ? 2 : 1;
      targetHour = 12;
    }
  }

  // FIX #5: Calcular la fecha objetivo usando aritmética de días en la misma
  // zona PR. Construimos la fecha con new Date(year, month-1, day+daysToAdd)
  // que usa la timezone del servidor (UTC en Vercel). Pero como enviamos
  // timezone=America/Puerto_Rico junto con este string, Late.dev interpreta
  // el datetime como hora PR. Lo importante es que el string represente
  // la hora PR deseada, NO UTC.
  const target = new Date(year, month - 1, dayNum + daysToAdd);
  const pad = (n: number) => n.toString().padStart(2, '0');

  const scheduledTime = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(targetHour)}:00:00`;

  console.log(`[Pioneer] getNextOptimalTime: PR now=${get('weekday')} ${get('hour')}:${get('minute')}, target=${scheduledTime} (PR timezone)`);

  return scheduledTime;
}

export const PR_TIMEZONE = 'America/Puerto_Rico';

// ═══════════════════════════════════════════════════════
// ANALYTICS — Late.dev Analytics Add-on
// ═══════════════════════════════════════════════════════

export interface LateAnalyticsPost {
  postId: string;
  latePostId: string | null;
  status: string;
  content: string;
  publishedAt: string | null;
  platform: string;
  platformPostUrl: string | null;
  isExternal: boolean;
  analytics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
    views: number;
    engagementRate: number;
    lastUpdated: string;
  };
}

export interface LateAnalyticsListResponse {
  posts: LateAnalyticsPost[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

/**
 * Fetch analytics for all posts from Late.dev
 * Requires analytics add-on to be active
 */
export async function fetchAnalytics(options?: {
  profileId?: string;
  source?: 'late' | 'external' | 'all';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  page?: number;
  sortBy?: 'date' | 'engagement';
}): Promise<LateAnalyticsListResponse> {
  const params = new URLSearchParams();
  if (options?.profileId) params.set('profileId', options.profileId);
  if (options?.source) params.set('source', options.source);
  if (options?.fromDate) params.set('fromDate', options.fromDate);
  if (options?.toDate) params.set('toDate', options.toDate);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.page) params.set('page', String(options.page));
  if (options?.sortBy) params.set('sortBy', options.sortBy);

  const query = params.toString();
  const endpoint = `/analytics${query ? `?${query}` : ''}`;

  return lateRequest<LateAnalyticsListResponse>(endpoint);
}

/**
 * Fetch analytics for a single post by Late post ID
 */
export async function fetchPostAnalytics(postId: string): Promise<LateAnalyticsPost> {
  return lateRequest<LateAnalyticsPost>(`/analytics?postId=${postId}`);
}

/**
 * Fetch follower stats for connected accounts
 */
export async function fetchFollowerStats(options?: {
  profileId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{
  accounts: Array<{
    _id: string;
    platform: string;
    username: string;
    currentFollowers: number;
    growth: number;
    growthPercentage: number;
  }>;
}> {
  const params = new URLSearchParams();
  if (options?.profileId) params.set('profileId', options.profileId);
  if (options?.fromDate) params.set('fromDate', options.fromDate);
  if (options?.toDate) params.set('toDate', options.toDate);

  const query = params.toString();
  return lateRequest(`/accounts/follower-stats${query ? `?${query}` : ''}`);
}
