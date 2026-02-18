// db.ts — Database operations for Pioneer Agent
//
// CRUD functions for sessions, plans, posts, and connected_accounts.
// All functions use the server-side Supabase client (secret key).
//
// PRINCIPLE: DB is the source of truth for content, counters, and platforms.
// Frontend only needs sessionId + planId + postId to reference data.

import { supabase } from './supabase';

// ============================================================
// TYPES
// ============================================================

export interface DbSession {
  id: string;
  business_name: string | null;
  business_info: Record<string, unknown>;
  interview_data: Record<string, unknown>;
  strategies: string[];
  email: string | null;
  status: 'interview' | 'strategy' | 'planning' | 'active' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface DbPlan {
  id: string;
  session_id: string;
  plan_name: string | null;
  description: string | null;
  post_count: number;
  posts_published: number;
  queue_slots: Array<{ dayOfWeek: number; time: string }>;
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  created_at: string;
  approved_at: string | null;
}

export interface DbPost {
  id: string;
  plan_id: string;
  order_num: number;
  title: string | null;
  content: string | null;
  image_prompt: string | null;
  image_model: string;
  image_aspect_ratio: string;
  image_url: string | null;
  late_draft_id: string | null;
  late_post_id: string | null;
  status: 'pending' | 'content_ready' | 'image_ready' | 'scheduled' | 'published' | 'failed';
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbConnectedAccount {
  id: string;
  session_id: string;
  platform: string;
  account_id: string;
  username: string | null;
  page_id: string | null;
  created_at: string;
}

// ============================================================
// SESSIONS
// ============================================================

export async function createSession(): Promise<DbSession> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({})
    .select()
    .single();

  if (error) throw new Error(`Error creating session: ${error.message}`);
  return data;
}

export async function getSession(sessionId: string): Promise<DbSession | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('id', sessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Error getting session: ${error.message}`);
  }
  return data;
}

export async function updateSession(
  sessionId: string,
  updates: Partial<Pick<DbSession, 'business_name' | 'business_info' | 'interview_data' | 'strategies' | 'email' | 'status'>>
): Promise<DbSession> {
  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw new Error(`Error updating session: ${error.message}`);
  return data;
}

// ============================================================
// PLANS
// ============================================================

export async function createPlan(
  sessionId: string,
  planData: {
    plan_name?: string;
    description?: string;
    post_count: number;
    queue_slots?: Array<{ dayOfWeek: number; time: string }>;
  }
): Promise<DbPlan> {
  const { data, error } = await supabase
    .from('plans')
    .insert({
      session_id: sessionId,
      plan_name: planData.plan_name,
      description: planData.description,
      post_count: planData.post_count,
      queue_slots: planData.queue_slots || [],
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Error creating plan: ${error.message}`);
  return data;
}

export async function getPlan(planId: string): Promise<DbPlan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select()
    .eq('id', planId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Error getting plan: ${error.message}`);
  }
  return data;
}

export async function getActivePlan(sessionId: string): Promise<DbPlan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select()
    .eq('session_id', sessionId)
    .in('status', ['approved', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Error getting active plan: ${error.message}`);
  }
  return data;
}

export async function getAllPlans(sessionId: string): Promise<DbPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function approvePlan(planId: string): Promise<DbPlan> {
  const { data, error } = await supabase
    .from('plans')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .select()
    .single();

  if (error) throw new Error(`Error approving plan: ${error.message}`);
  return data;
}

export async function incrementPostsPublished(planId: string): Promise<DbPlan> {
  // Atomic increment using Supabase RPC to avoid race conditions
  const { error: rpcError } = await supabase
    .rpc('increment_posts_published', { p_plan_id: planId });

  if (rpcError) {
    // Fallback to manual increment if RPC not available yet
    console.warn('[Pioneer DB] RPC not available, using fallback:', rpcError.message);
    const plan = await getPlan(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const newCount = plan.posts_published + 1;
    const isComplete = newCount >= plan.post_count;

    const { data, error } = await supabase
      .from('plans')
      .update({
        posts_published: newCount,
        status: isComplete ? 'completed' : 'in_progress',
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) throw new Error(`Error incrementing posts_published: ${error.message}`);
    return data;
  }

  // RPC returns void — fetch the updated plan to check completion
  const plan = await getPlan(planId);
  if (!plan) throw new Error(`Plan not found after increment: ${planId}`);

  // Check if plan is now complete and update status
  if (plan.posts_published >= plan.post_count && plan.status !== 'completed') {
    const { data, error } = await supabase
      .from('plans')
      .update({ status: 'completed' })
      .eq('id', planId)
      .select()
      .single();

    if (error) throw new Error(`Error updating plan status: ${error.message}`);
    return data;
  }

  // Update status to in_progress if still in early stage
  if (plan.status === 'draft' || plan.status === 'approved') {
    const { data, error } = await supabase
      .from('plans')
      .update({ status: 'in_progress' })
      .eq('id', planId)
      .select()
      .single();

    if (!error && data) return data;
  }

  return plan;
}

// ============================================================
// POSTS
// ============================================================

export async function createPost(
  planId: string,
  postData: {
    order_num: number;
    title?: string;
    content?: string;
    image_prompt?: string;
    image_model?: string;
    image_aspect_ratio?: string;
    scheduled_for?: string;
  }
): Promise<DbPost> {
  const hasContent = postData.content && postData.content.length > 0;

  const { data, error } = await supabase
    .from('posts')
    .insert({
      plan_id: planId,
      order_num: postData.order_num,
      title: postData.title,
      content: postData.content || null,
      image_prompt: postData.image_prompt,
      image_model: postData.image_model || 'schnell',
      image_aspect_ratio: postData.image_aspect_ratio || '1:1',
      scheduled_for: postData.scheduled_for || null,
      status: hasContent ? 'content_ready' : 'pending',
    })
    .select()
    .single();

  if (error) throw new Error(`Error creating post: ${error.message}`);
  return data;
}

export async function getPost(postId: string): Promise<DbPost | null> {
  const { data, error } = await supabase
    .from('posts')
    .select()
    .eq('id', postId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Error getting post: ${error.message}`);
  }
  return data;
}

export async function getPostsByPlan(planId: string): Promise<DbPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select()
    .eq('plan_id', planId)
    .order('order_num', { ascending: true });

  if (error) throw new Error(`Error getting posts: ${error.message}`);
  return data || [];
}

export async function getNextPendingPost(planId: string): Promise<DbPost | null> {
  const { data, error } = await supabase
    .from('posts')
    .select()
    .eq('plan_id', planId)
    .eq('status', 'pending')
    .order('order_num', { ascending: true })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Error getting next pending post: ${error.message}`);
  }
  return data;
}

export async function updatePost(
  postId: string,
  updates: Partial<Pick<DbPost,
    'content' | 'image_prompt' | 'image_model' | 'image_aspect_ratio' |
    'image_url' | 'late_draft_id' | 'late_post_id' | 'status' |
    'scheduled_for' | 'published_at' | 'title'
  >>
): Promise<DbPost> {
  const { data, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .select()
    .single();

  if (error) throw new Error(`Error updating post: ${error.message}`);
  return data;
}

export async function markPostScheduled(
  postId: string,
  lateDraftId: string,
  scheduledFor?: string
): Promise<DbPost> {
  return updatePost(postId, {
    late_draft_id: lateDraftId,
    status: 'scheduled',
    scheduled_for: scheduledFor,
  });
}

export async function markPostPublished(
  postId: string,
  latePostId?: string
): Promise<DbPost> {
  return updatePost(postId, {
    late_post_id: latePostId,
    status: 'published',
    published_at: new Date().toISOString(),
  });
}

// ============================================================
// CONNECTED ACCOUNTS
// ============================================================

export async function saveConnectedAccount(
  sessionId: string,
  account: {
    platform: string;
    account_id: string;
    username?: string;
    page_id?: string;
  }
): Promise<DbConnectedAccount> {
  const { data, error } = await supabase
    .from('connected_accounts')
    .upsert(
      {
        session_id: sessionId,
        platform: account.platform,
        account_id: account.account_id,
        username: account.username,
        page_id: account.page_id,
      },
      { onConflict: 'session_id,account_id' }
    )
    .select()
    .single();

  if (error) throw new Error(`Error saving connected account: ${error.message}`);
  return data;
}

export async function getConnectedAccounts(sessionId: string): Promise<DbConnectedAccount[]> {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select()
    .eq('session_id', sessionId);

  if (error) throw new Error(`Error getting connected accounts: ${error.message}`);
  return data || [];
}

// ============================================================
// CONVENIENCE: Get plan progress (for post counter)
// ============================================================

export async function getPlanProgress(planId: string): Promise<{
  postCount: number;
  postsPublished: number;
  isComplete: boolean;
} | null> {
  const plan = await getPlan(planId);
  if (!plan) return null;

  return {
    postCount: plan.post_count,
    postsPublished: plan.posts_published,
    isComplete: plan.posts_published >= plan.post_count,
  };
}

// ============================================================
// METRICS (Fase 8 — Late.dev Analytics)
// ============================================================

export interface DbMetric {
  id: string;
  post_id: string;
  late_post_id: string | null;
  platform: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  views: number;
  engagement_rate: number;
  synced_at: string;
}

export async function upsertMetric(postId: string, data: {
  late_post_id?: string | null;
  platform: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  views: number;
  engagement_rate: number;
}): Promise<void> {
  // Upsert: if metric for this post_id exists, update it
  const { data: existing } = await supabase
    .from('metrics')
    .select('id')
    .eq('post_id', postId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('metrics')
      .update({
        ...data,
        synced_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('metrics')
      .insert({
        post_id: postId,
        ...data,
        synced_at: new Date().toISOString(),
      });
  }
}

export async function getMetricsByPlan(planId: string): Promise<DbMetric[]> {
  // Join metrics with posts to get metrics for all posts in a plan
  const { data: posts } = await supabase
    .from('posts')
    .select('id')
    .eq('plan_id', planId);

  if (!posts || posts.length === 0) return [];

  const postIds = posts.map(p => p.id);
  const { data: metrics } = await supabase
    .from('metrics')
    .select('*')
    .in('post_id', postIds)
    .order('synced_at', { ascending: false });

  return metrics || [];
}

export async function getMetricsBySession(sessionId: string): Promise<DbMetric[]> {
  // Get all plans for session, then all posts, then all metrics
  const { data: plans } = await supabase
    .from('plans')
    .select('id')
    .eq('session_id', sessionId);

  if (!plans || plans.length === 0) return [];

  const planIds = plans.map(p => p.id);
  const { data: posts } = await supabase
    .from('posts')
    .select('id')
    .in('plan_id', planIds);

  if (!posts || posts.length === 0) return [];

  const postIds = posts.map(p => p.id);
  const { data: metrics } = await supabase
    .from('metrics')
    .select('*')
    .in('post_id', postIds)
    .order('synced_at', { ascending: false });

  return metrics || [];
}

// ============================================================
// MESSAGES — Persist chat conversations
// ============================================================

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!content || content.trim().length === 0) return;

  const { error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      role,
      content: content.substring(0, 50000), // Safety limit
      metadata: metadata || {},
    });

  if (error) {
    console.warn('[Pioneer DB] Error saving message:', error.message);
  }
}

export async function getRecentMessages(
  sessionId: string,
  limit: number = 20
): Promise<DbMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[Pioneer DB] Error getting messages:', error.message);
    return [];
  }

  // Return in chronological order
  return (data || []).reverse();
}

export async function getMessageCount(sessionId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (error) return 0;
  return count || 0;
}

// ============================================================
// CONTEXT SUMMARIES — Condensed conversation context
// ============================================================

export interface DbContextSummary {
  id: string;
  session_id: string;
  summary: string;
  message_count: number;
  created_at: string;
}

export async function getLatestContextSummary(sessionId: string): Promise<DbContextSummary | null> {
  const { data, error } = await supabase
    .from('context_summaries')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function saveContextSummary(
  sessionId: string,
  summary: string,
  messageCount: number
): Promise<void> {
  const { error } = await supabase
    .from('context_summaries')
    .insert({
      session_id: sessionId,
      summary,
      message_count: messageCount,
    });

  if (error) {
    console.warn('[Pioneer DB] Error saving context summary:', error.message);
  }
}

// ============================================================
// PERFORMANCE DATA — Aggregated stats for dashboard
// ============================================================

export interface PerformanceData {
  totalPlans: number;
  completedPlans: number;
  totalPosts: number;
  publishedPosts: number;
  totalImpressions: number;
  totalLikes: number;
  totalComments: number;
  avgEngagementRate: number;
}

export async function getPerformanceData(sessionId: string): Promise<PerformanceData> {
  const defaults: PerformanceData = {
    totalPlans: 0, completedPlans: 0,
    totalPosts: 0, publishedPosts: 0,
    totalImpressions: 0, totalLikes: 0, totalComments: 0,
    avgEngagementRate: 0,
  };

  try {
    const plans = await getAllPlans(sessionId);
    defaults.totalPlans = plans.length;
    defaults.completedPlans = plans.filter(p => p.status === 'completed').length;

    const planIds = plans.map(p => p.id);
    if (planIds.length > 0) {
      const { data: posts } = await supabase
        .from('posts')
        .select('id, status')
        .in('plan_id', planIds);

      if (posts) {
        defaults.totalPosts = posts.length;
        defaults.publishedPosts = posts.filter(p => p.status === 'scheduled' || p.status === 'published').length;
      }
    }

    const metrics = await getMetricsBySession(sessionId);
    if (metrics.length > 0) {
      defaults.totalImpressions = metrics.reduce((sum, m) => sum + (m.impressions || 0), 0);
      defaults.totalLikes = metrics.reduce((sum, m) => sum + (m.likes || 0), 0);
      defaults.totalComments = metrics.reduce((sum, m) => sum + (m.comments || 0), 0);
      const rates = metrics.filter(m => m.engagement_rate > 0).map(m => m.engagement_rate);
      defaults.avgEngagementRate = rates.length > 0
        ? rates.reduce((sum, r) => sum + r, 0) / rates.length
        : 0;
    }
  } catch (err) {
    console.warn('[Pioneer DB] Error getting performance data:', err);
  }

  return defaults;
}
