// metrics-sync.ts — Fase 8: Sync analytics from Late.dev to Supabase
//
// Pulls post performance metrics from Late.dev Analytics API
// and saves them to the metrics table in Supabase.
//
// Called by: /api/cron/suggestions (same daily cron, after suggestions)
// Also callable: GET /api/metrics/sync
//
// PRINCIPLE: Use Late.dev native analytics API — no custom tracking needed

import { fetchAnalytics } from './late-client';
import { supabase } from './supabase';
import { upsertMetric } from './db';

const PIONEER_PROFILE_ID = '6984c371b984889d86a8b3d6';

export async function syncAllMetrics(): Promise<{
  synced: number;
  errors: string[];
}> {
  let synced = 0;
  const errors: string[] = [];

  try {
    // Fetch analytics for posts published via Late (source=late)
    // Get last 30 days, sorted by date
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await fetchAnalytics({
        profileId: PIONEER_PROFILE_ID,
        source: 'late',
        fromDate,
        limit: 50,
        page,
        sortBy: 'date',
      });

      if (!result.posts || result.posts.length === 0) {
        hasMore = false;
        break;
      }

      for (const post of result.posts) {
        try {
          // Late.dev provides latePostId which should match our late_draft_id or late_post_id
          const lateId = post.latePostId || post.postId;
          
          // Try to find the post in our DB — check both ID fields
          let dbPost = null;
          
          // First try late_post_id (set after activation)
          const { data: byPostId } = await supabase
            .from('posts')
            .select('id')
            .eq('late_post_id', lateId)
            .maybeSingle();
          
          if (byPostId) {
            dbPost = byPostId;
          } else {
            // Fallback: try late_draft_id (set at draft creation)
            const { data: byDraftId } = await supabase
              .from('posts')
              .select('id')
              .eq('late_draft_id', lateId)
              .maybeSingle();
            dbPost = byDraftId;
          }

          if (!dbPost) {
            // Post not in our DB — might be from before we tracked, skip
            continue;
          }

          await upsertMetric(dbPost.id, {
            late_post_id: latePostId,
            platform: post.platform,
            impressions: post.analytics.impressions || 0,
            reach: post.analytics.reach || 0,
            likes: post.analytics.likes || 0,
            comments: post.analytics.comments || 0,
            shares: post.analytics.shares || 0,
            clicks: post.analytics.clicks || 0,
            views: post.analytics.views || 0,
            engagement_rate: post.analytics.engagementRate || 0,
          });

          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`Post ${post.postId}: ${msg}`);
        }
      }

      // Check if there are more pages
      if (result.pagination && page < result.pagination.pages) {
        page++;
      } else {
        hasMore = false;
      }
    }

    console.log(`[MetricsSync] Done: ${synced} posts synced, ${errors.length} errors`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    errors.push(`Fatal: ${msg}`);
    console.error('[MetricsSync] Fatal error:', err);
  }

  return { synced, errors };
}
