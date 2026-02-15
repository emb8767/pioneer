// GET /api/suggestions — Returns pending suggestions for a session
// POST /api/suggestions — Accept or dismiss a suggestion

import { NextRequest, NextResponse } from 'next/server';
import { getPendingSuggestions, updateSuggestionStatus } from '@/lib/suggestion-engine';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  try {
    const suggestions = await getPendingSuggestions(sessionId);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[Pioneer] Error fetching suggestions:', error);
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { suggestionId, action } = body;

    if (!suggestionId || !action) {
      return NextResponse.json({ error: 'suggestionId and action required' }, { status: 400 });
    }

    if (!['accepted', 'dismissed'].includes(action)) {
      return NextResponse.json({ error: 'action must be "accepted" or "dismissed"' }, { status: 400 });
    }

    await updateSuggestionStatus(suggestionId, action);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Pioneer] Error updating suggestion:', error);
    return NextResponse.json({ error: 'Failed to update suggestion' }, { status: 500 });
  }
}
