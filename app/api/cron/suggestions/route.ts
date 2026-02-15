// GET /api/cron/suggestions — Vercel Cron Job
// Runs daily at 8:00 AM AST (12:00 UTC)
// Generates suggestions for all active sessions

import { NextRequest, NextResponse } from 'next/server';
import { generateAllSuggestions } from '@/lib/suggestion-engine';

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in development or if no CRON_SECRET is set
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('[Pioneer Cron] Starting daily suggestion generation...');

  try {
    const result = await generateAllSuggestions();

    console.log(`[Pioneer Cron] Done: ${result.processed} sessions processed, ${result.suggestionsCreated} suggestions created, ${result.errors.length} errors`);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[Pioneer Cron] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
