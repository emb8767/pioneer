// GET /api/cron/suggestions — Vercel Cron Job
// Runs daily at 8:00 AM AST (12:00 UTC)
// 1. Syncs analytics metrics from Late.dev
// 2. Generates suggestions for all active sessions (enriched with metrics)
// 3. Sends email notifications for new suggestions

import { NextRequest, NextResponse } from 'next/server';
import { generateAllSuggestions } from '@/lib/suggestion-engine';
import { syncAllMetrics } from '@/lib/metrics-sync';
import { sendSuggestionEmail } from '@/lib/brevo-client';
import { supabase } from '@/lib/supabase';

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

  // Step 3: Send email notifications for sessions with new suggestions
  let emailsSent = 0;
  const emailErrors: string[] = [];

  if (suggestionsResult.suggestionsCreated > 0) {
    try {
      // Find suggestions created in the last hour (from this cron run)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: newSuggestions } = await supabase
        .from('suggestions')
        .select('session_id, title, description, priority')
        .eq('status', 'pending')
        .gte('created_at', oneHourAgo);

      if (newSuggestions && newSuggestions.length > 0) {
        // Group suggestions by session
        const bySession = new Map<string, Array<{ title: string; description: string; priority: number }>>();
        for (const s of newSuggestions) {
          const list = bySession.get(s.session_id) || [];
          list.push({ title: s.title, description: s.description, priority: s.priority });
          bySession.set(s.session_id, list);
        }

        // Send email for each session that has an email
        for (const [sessionId, suggestions] of bySession) {
          try {
            const { data: session } = await supabase
              .from('sessions')
              .select('business_name, email')
              .eq('id', sessionId)
              .single();

            if (session?.email) {
              const result = await sendSuggestionEmail(
                session.business_name || 'Su negocio',
                session.email,
                suggestions
              );
              if (result.success) {
                emailsSent++;
                console.log(`[Pioneer Cron] Email sent to ${session.email} (${session.business_name})`);
              } else {
                emailErrors.push(`${session.business_name}: ${result.error}`);
              }
            }
          } catch (err) {
            emailErrors.push(`Session ${sessionId}: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      }
    } catch (err) {
      emailErrors.push(err instanceof Error ? err.message : 'Email notification error');
    }
  }

  return NextResponse.json({
    success: true,
    metrics: metricsResult,
    suggestions: suggestionsResult,
    emails: { sent: emailsSent, errors: emailErrors },
  });
}
