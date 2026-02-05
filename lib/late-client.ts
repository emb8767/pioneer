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

export async function getConnectUrl(
  platform: Platform,
  profileId: string
): Promise<{ authUrl: string }> {
  return lateRequest(`/connect/${platform}?profileId=${profileId}`);
}

// Bluesky usa App Password en vez de OAuth
export async function connectBluesky(
  profileId: string,
  handle: string,
  appPassword: string
): Promise<LateAccount> {
  return lateRequest('/connect/bluesky', {
    method: 'POST',
    body: JSON.stringify({ profileId, handle, appPassword }),
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
