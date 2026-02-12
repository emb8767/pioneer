// Tipos compartidos para Pioneer Agent

// === PLATFORM CHARACTER LIMITS ===
// Moved from content-generator.ts (Fase 5 cleanup)
// Used by publish-validator.ts for content validation

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
  reddit: 40000,
  bluesky: 300,
  threads: 500,
  googlebusiness: 1500,
  telegram: 4096,
  snapchat: 250,
};

// === CONTENT WRITER ===

export type PostType =
  | 'oferta'
  | 'educativo'
  | 'testimonio'
  | 'detras_de_escenas'
  | 'urgencia'
  | 'cta'
  | 'branding'
  | 'interactivo';

export type Platform =
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'bluesky'
  | 'threads'
  | 'googlebusiness'
  | 'telegram'
  | 'snapchat';

export interface ContentRequest {
  business_name: string;
  business_type: string;
  post_type: PostType;
  objective: string;
  details: string;
  platforms: Platform[];
  tone?: 'formal' | 'casual' | 'urgente';
  include_hashtags?: boolean;
}

export interface PlatformContent {
  text: string;
  char_count: number;
}

export interface ContentResponse {
  content: {
    text: string;
    hashtags: string[];
    platform_versions: Partial<Record<Platform, PlatformContent>>;
  };
  metadata: {
    post_type: PostType;
    estimated_cost: number;
  };
}

// === SOCIAL MEDIA (Late.dev) ===

export interface LateProfile {
  _id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface LateAccount {
  _id: string;
  platform: Platform;
  username: string;
  profileId: string;
}

export interface LatePlatformTarget {
  platform: Platform;
  accountId: string;
}

export interface LateMediaItem {
  type: 'image' | 'video';
  url: string;
}

export interface PublishRequest {
  content: string;
  platforms: LatePlatformTarget[];
  scheduledFor?: string;
  timezone?: string;
  publishNow?: boolean;
  mediaItems?: LateMediaItem[];
  // === Queue support (Late.dev) ===
  // Cuando se proporciona queuedFromProfile (sin scheduledFor),
  // Late.dev asigna automáticamente el próximo slot disponible.
  // NUNCA combinar con scheduledFor — eso bypasea el queue.
  queuedFromProfile?: string;
  queueId?: string;
}

export interface LatePost {
  _id: string;
  content: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  scheduledFor?: string;
  platforms: Array<{
    platform: Platform;
    accountId: string;
    status: 'pending' | 'published' | 'failed';
  }>;
}

// === QUEUE (Late.dev) ===

export interface QueueSlot {
  dayOfWeek: number; // 0=domingo, 1=lunes, ..., 6=sábado
  time: string;      // formato "HH:MM" (ej: "12:00", "19:00")
}

export interface QueueConfig {
  profileId: string;
  timezone: string;
  slots: QueueSlot[];
  active: boolean;
}

export interface QueueNextSlotResponse {
  profileId: string;
  nextSlot: string;   // ISO datetime
  timezone: string;
}

// === CHAT ===

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// === PLAN (Strategy Engine) ===

export interface PlanAction {
  order: number;
  type: 'content_creation' | 'publish' | 'email' | 'ads';
  description: string;
  day: number;
  estimated_cost: number;
}

export interface MarketingPlan {
  plan_name: string;
  duration_days: number;
  channels: Platform[];
  actions: PlanAction[];
  total_cost_organic: number;
  total_cost_with_ads: number;
  status: 'pending_approval' | 'approved' | 'in_progress' | 'completed';
}
