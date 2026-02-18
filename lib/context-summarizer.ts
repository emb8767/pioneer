// lib/context-summarizer.ts — Generate condensed conversation summaries
//
// Called by cron. For each active session:
// 1. Count messages since last summary
// 2. If 10+ new messages → generate summary via Claude isolated call
// 3. Save to context_summaries table
// 4. Summary gets injected into system prompt for future conversations
//
// Cost: ~$0.01 per summary (1 Claude call, ~2000 tokens in, ~500 out)

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase';
import {
  getRecentMessages,
  getMessageCount,
  getLatestContextSummary,
  saveContextSummary,
} from './db';

const anthropicClient = new Anthropic();

const MIN_NEW_MESSAGES = 10; // Don't summarize unless there are enough new messages

export async function generateAllContextSummaries(): Promise<{
  processed: number;
  created: number;
}> {
  let processed = 0;
  let created = 0;

  // Find all active sessions (have business_info)
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, business_name')
    .not('business_info', 'eq', '{}')
    .in('status', ['active', 'planning', 'strategy']);

  if (!sessions || sessions.length === 0) return { processed, created };

  for (const session of sessions) {
    try {
      processed++;

      // Check how many messages exist
      const totalMessages = await getMessageCount(session.id);
      if (totalMessages === 0) continue;

      // Check last summary
      const lastSummary = await getLatestContextSummary(session.id);
      const lastSummarizedCount = lastSummary?.message_count || 0;
      const newMessages = totalMessages - lastSummarizedCount;

      if (newMessages < MIN_NEW_MESSAGES) continue;

      // Get recent messages for summarization (last 50)
      const messages = await getRecentMessages(session.id, 50);
      if (messages.length === 0) continue;

      // Build conversation text
      const conversationText = messages
        .map(m => `${m.role === 'user' ? 'Cliente' : 'Pioneer'}: ${m.content.substring(0, 500)}`)
        .join('\n\n');

      // Generate summary via Claude isolated call
      const summary = await generateSummary(
        session.business_name || 'Cliente',
        conversationText,
        lastSummary?.summary || null
      );

      if (summary) {
        await saveContextSummary(session.id, summary, totalMessages);
        created++;
        console.log(`[Pioneer Context] Summary generated for ${session.business_name} (${totalMessages} msgs)`);
      }

    } catch (err) {
      console.error(`[Pioneer Context] Error for session ${session.id}:`, err);
    }
  }

  return { processed, created };
}

async function generateSummary(
  businessName: string,
  conversationText: string,
  previousSummary: string | null
): Promise<string | null> {
  try {
    const previousContext = previousSummary
      ? `\n\nRESUMEN ANTERIOR:\n${previousSummary}\n\nActualiza este resumen con la nueva información.`
      : '';

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      system: `You are a context summarizer. Generate a concise summary (max 400 words) of the conversation between a marketing AI (Pioneer) and a business client. Focus on:
- Client preferences and communication style
- Decisions made (strategies chosen, content approved/rejected)
- Feedback given (what they liked, what they wanted changed)
- Business goals and priorities mentioned
- Any personal details relevant to marketing (target audience, seasonal patterns)

Write in Spanish. Be factual and concise. Do NOT include greetings or filler.${previousContext}`,
      messages: [
        {
          role: 'user',
          content: `Negocio: ${businessName}\n\nCONVERSACIÓN:\n${conversationText}\n\nGenera el resumen de contexto:`,
        },
      ],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text || null;

  } catch (err) {
    console.error('[Pioneer Context] Claude API error:', err);
    return null;
  }
}
