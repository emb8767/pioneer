// Tipos compartidos para Pioneer Agent

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
