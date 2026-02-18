// /api/performance/route.ts — Performance data for sidebar dashboard
//
// GET /api/performance → returns aggregated stats for authenticated user

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabase as adminSupabase } from '@/lib/supabase';
import { getPerformanceData } from '@/lib/db';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Find session by user_id
    const { data: session } = await adminSupabase
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({
        totalPlans: 0, completedPlans: 0,
        totalPosts: 0, publishedPosts: 0,
        totalImpressions: 0, totalLikes: 0, totalComments: 0,
        avgEngagementRate: 0,
      });
    }

    const performance = await getPerformanceData(session.id);
    return NextResponse.json(performance);

  } catch (error) {
    console.error('[Pioneer] Performance error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
