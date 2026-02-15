// GET /api/cron/suggestions — Vercel Cron Job
// Runs daily at 8:00 AM AST (12:00 UTC)
// 1. Syncs analytics metrics from Late.dev
// 2. Generates suggestions for all active sessions (enriched with metrics)

import { NextRequest, NextResponse } from 'next/server';
import { generateAllSuggestions } from '@/lib/suggestion-engine';
import { syncAllMetrics } from '@/lib/metrics-sync';

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('[Pioneer Cron] Starting daily metrics sync + suggestion generation...');

  // Step 1: Sync metrics from Late.dev
  let metricsResult = { synced: 0, errors: [] as string[] };
  try {
    metricsResult = await syncAllMetrics();
    console.log(`[Pioneer Cron] Metrics: ${metricsResult.synced} posts synced, ${metricsResult.errors.length} errors`);
  } catch (error) {
    console.error('[Pioneer Cron] Metrics sync error (non-fatal):', error);
    metricsResult.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  // Step 2: Generate suggestions (now with fresh metrics data)
  let suggestionsResult = { processed: 0, suggestionsCreated: 0, errors: [] as string[] };
  try {
    suggestionsResult = await generateAllSuggestions();
    console.log(`[Pioneer Cron] Suggestions: ${suggestionsResult.processed} sessions, ${suggestionsResult.suggestionsCreated} created, ${suggestionsResult.errors.length} errors`);
  } catch (error) {
    console.error('[Pioneer Cron] Suggestions error:', error);
    suggestionsResult.errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return NextResponse.json({
    success: true,
    metrics: metricsResult,
    suggestions: suggestionsResult,
  });
}
