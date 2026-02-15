// suggestion-engine.ts — Fase 7: Proactive suggestion generation
//
// Analyzes active sessions and generates 1-3 marketing suggestions
// based on: business_info, strategies used, PR calendar, last plan.
//
// Called by: /api/cron/suggestions (daily at 8:00 AM AST)
// Also callable manually from: /api/suggestions?generate=true
//
// PRINCIPLE: Claude aislada con system prompt corto = 99.9% confiable

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { supabase } from './supabase';
import type { DbSession, DbPlan } from './db';
import { getMetricsBySession } from './db';

// ============================================================
// TYPES
// ============================================================

export interface Suggestion {
  session_id: string;
  type: 'new_plan' | 'seasonal' | 'follow_up' | 'strategy_change';
  title: string;
  description: string;
  strategy_id: string | null;
  priority: number;
  expires_at: string | null;
}

interface SessionWithPlans extends DbSession {
  plans: DbPlan[];
}

// ============================================================
// MAIN: Generate suggestions for all active sessions
// ============================================================

export async function generateAllSuggestions(): Promise<{
  processed: number;
  suggestionsCreated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let suggestionsCreated = 0;

  // 1. Get all active sessions (have business_info)
  const { data: sessions, error: sessError } = await supabase
    .from('sessions')
    .select('*')
    .eq('status', 'active')
    .not('business_info', 'is', null);

  if (sessError || !sessions) {
    return { processed: 0, suggestionsCreated: 0, errors: [sessError?.message || 'No sessions found'] };
  }

  console.log(`[SuggestionEngine] Processing ${sessions.length} active sessions`);

  // 2. For each session, load plans and generate suggestions
  for (const session of sessions) {
    try {
      // Load plans for this session
      const { data: plans } = await supabase
        .from('plans')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false });

      const sessionWithPlans: SessionWithPlans = {
        ...session,
        plans: plans || [],
      };

      // Clear expired suggestions
      await supabase
        .from('suggestions')
        .update({ status: 'expired' })
        .eq('session_id', session.id)
        .eq('status', 'pending')
        .lt('expires_at', new Date().toISOString());

      // Check if there are already pending suggestions
      const { count } = await supabase
        .from('suggestions')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session.id)
        .eq('status', 'pending');

      if (count && count >= 3) {
        console.log(`[SuggestionEngine] Session ${session.id} already has ${count} pending suggestions, skipping`);
        continue;
      }

      // Load metrics for this session
      let metricsContext: string | null = null;
      try {
        const metrics = await getMetricsBySession(session.id);
        if (metrics.length > 0) {
          const metricsSummary = metrics.slice(0, 10).map(m => 
            `- Post ${m.post_id.substring(0, 8)}: ${m.platform} — ${m.likes} likes, ${m.comments} comments, ${m.shares} shares, ${m.impressions} impressions, engagement ${m.engagement_rate}%`
          ).join('\n');
          
          const totalLikes = metrics.reduce((s, m) => s + m.likes, 0);
          const totalImpressions = metrics.reduce((s, m) => s + m.impressions, 0);
          const avgEngagement = metrics.length > 0
            ? (metrics.reduce((s, m) => s + m.engagement_rate, 0) / metrics.length).toFixed(2)
            : '0';
          
          metricsContext = `=== POST PERFORMANCE METRICS ===\nTotal posts tracked: ${metrics.length}\nTotal likes: ${totalLikes} | Total impressions: ${totalImpressions} | Avg engagement: ${avgEngagement}%\n\nTop posts:\n${metricsSummary}`;
        }
      } catch {
        // Non-fatal — suggestions work without metrics
      }

      // Generate new suggestions
      const suggestions = await generateSuggestionsForSession(sessionWithPlans, metricsContext);


      // Save to DB
      for (const suggestion of suggestions) {
        const { error: insertError } = await supabase
          .from('suggestions')
          .insert(suggestion);

        if (insertError) {
          errors.push(`Session ${session.id}: ${insertError.message}`);
        } else {
          suggestionsCreated++;
        }
      }

      console.log(`[SuggestionEngine] Session ${session.id} (${session.business_name}): ${suggestions.length} suggestions created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Session ${session.id}: ${msg}`);
      console.error(`[SuggestionEngine] Error processing session ${session.id}:`, err);
    }
  }

  return { processed: sessions.length, suggestionsCreated, errors };
}

// ============================================================
// Generate suggestions for a single session
// ============================================================

async function generateSuggestionsForSession(session: SessionWithPlans, metricsContext: string | null = null): Promise<Suggestion[]> {
  const context = buildSessionContext(session, metricsContext);

  // If no context worth analyzing, skip
  if (!context) return [];

  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: `You generate marketing suggestions for small businesses in Puerto Rico.
Output ONLY a JSON array of 1-3 suggestions. No preamble, no markdown, no explanation.

Each suggestion must have:
{
  "type": "new_plan" | "seasonal" | "follow_up" | "strategy_change",
  "title": "Short title in Spanish (max 60 chars)",
  "description": "1-2 sentences in Spanish explaining the suggestion and why now",
  "strategy_id": "one of: valor|enganche|educacion|social|estacional|comunidad|referidos|antesdespues|frecuencia|vip|historia|garantia|ugc|comparacion|momento" or null,
  "priority": 1-10 (10 = most urgent)
}

Rules:
- "seasonal" type: ONLY if there's an upcoming date within 14 days
- "follow_up" type: suggest after a completed plan to keep momentum
- "new_plan" type: suggest a new strategy they haven't tried
- "strategy_change" type: suggest pivoting based on what they've done
- If POST PERFORMANCE METRICS are available, use them to make data-driven suggestions:
  * Suggest MORE of what gets high engagement
  * Suggest changing approach for low-performing content types
  * Reference specific metrics in your description (e.g. "Sus posts educativos obtuvieron 3x más interacción")
- All text in Spanish, professional but warm tone
- Suggestions must be actionable and specific to THIS business
- Use EXACT current date provided — never guess dates`,
    messages: [
      {
        role: 'user',
        content: context,
      },
      {
        role: 'assistant',
        content: '[',
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') return [];

  // Prefill started with '[', prepend it
  let jsonStr = '[' + block.text.trim();
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsed: Array<{
    type: string;
    title: string;
    description: string;
    strategy_id: string | null;
    priority: number;
  }>;

  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(`[SuggestionEngine] Failed to parse suggestions JSON: ${jsonStr.substring(0, 200)}`);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  // Calculate expiry (7 days for seasonal, 14 for others)
  const now = new Date();

  return parsed.slice(0, 3).map((s) => {
    const expiryDays = s.type === 'seasonal' ? 7 : 14;
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    return {
      session_id: session.id,
      type: (s.type || 'new_plan') as Suggestion['type'],
      title: (s.title || 'Nueva sugerencia').substring(0, 60),
      description: s.description || '',
      strategy_id: s.strategy_id || null,
      priority: Math.min(10, Math.max(1, s.priority || 5)),
      expires_at: expiresAt.toISOString(),
    };
  });
}

// ============================================================
// Build context string for Claude
// ============================================================

function buildSessionContext(session: SessionWithPlans, metricsContext: string | null = null): string | null {
  const info = session.business_info;
  if (!info || Object.keys(info).length === 0) return null;

  const parts: string[] = [];

  // Business info
  const fields = Object.entries(info)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  parts.push(`=== BUSINESS INFO ===\n${fields}`);

  // Strategies used
  if (session.strategies && session.strategies.length > 0) {
    parts.push(`=== STRATEGIES USED ===\n${session.strategies.join('\n')}`);
  }

  // Plans history
  if (session.plans.length > 0) {
    const planSummaries = session.plans.map((p) => {
      const status = p.status === 'completed' ? '✅ Completed' : `In progress (${p.posts_published}/${p.post_count})`;
      return `- "${p.plan_name || 'Sin nombre'}" (${p.post_count} posts) — ${status}`;
    }).join('\n');
    parts.push(`=== PLAN HISTORY ===\n${planSummaries}`);
  } else {
    parts.push('=== PLAN HISTORY ===\nNo plans created yet. This business completed the interview but hasn\'t started any campaign.');
  }

  // Upcoming PR calendar dates (next 14 days)
  const upcomingDates = getUpcoming14Days();
  if (upcomingDates) {
    parts.push(`=== UPCOMING DATES (Puerto Rico) ===\n${upcomingDates}`);
  }

  // Performance metrics (if available)
  if (metricsContext) {
    parts.push(metricsContext);
  }

  // Today's date
  const now = new Date().toLocaleDateString('es-PR', {
    timeZone: 'America/Puerto_Rico',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  parts.push(`=== TODAY ===\nHoy es ${now}. NUNCA inventes ni adivines fechas. Usa SOLO las fechas exactas del calendario de arriba.`);

  return parts.join('\n\n');
}

// ============================================================
// Calendar helper — next 14 days
// ============================================================

function getUpcoming14Days(): string | null {
  try {
    const calendarPath = path.join(process.cwd(), 'skills', 'pr-calendar.json');
    const raw = fs.readFileSync(calendarPath, 'utf-8');
    const calendar: Array<{
      month: number;
      day: number | null;
      name: string;
      opportunity: string;
      industries: string[];
    }> = JSON.parse(raw);

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' }));
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 14);
    const currentYear = now.getFullYear();

    const upcoming: string[] = [];

    for (const entry of calendar) {
      if (!entry.day) continue;
      const entryDate = new Date(currentYear, entry.month - 1, entry.day);
      if (entryDate < now) entryDate.setFullYear(currentYear + 1);

      if (entryDate >= now && entryDate <= windowEnd) {
        const daysAway = Math.ceil((entryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        // Include exact date so Claude never guesses
        const exactDate = entryDate.toLocaleDateString('es-PR', { weekday: 'long', day: 'numeric', month: 'long' });
        const urgency = daysAway === 0 ? 'HOY' : daysAway === 1 ? 'MAÑANA' : `en ${daysAway} días`;
        upcoming.push(`- ${entry.name} — FECHA EXACTA: ${exactDate} (${urgency}) — ${entry.opportunity}. Industries: ${entry.industries.join(', ')}`);
      }
    }

    return upcoming.length > 0 ? upcoming.join('\n') : null;
  } catch {
    return null;
  }
}

// ============================================================
// Get pending suggestions for a session
// ============================================================

export async function getPendingSuggestions(sessionId: string): Promise<Array<{
  id: string;
  type: string;
  title: string;
  description: string;
  strategy_id: string | null;
  priority: number;
  created_at: string;
  expires_at: string | null;
}>> {
  const { data, error } = await supabase
    .from('suggestions')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .order('priority', { ascending: false });

  if (error || !data) return [];
  return data;
}

// ============================================================
// Update suggestion status
// ============================================================

export async function updateSuggestionStatus(
  suggestionId: string,
  status: 'accepted' | 'dismissed'
): Promise<void> {
  await supabase
    .from('suggestions')
    .update({ status })
    .eq('id', suggestionId);
}
