-- Pioneer Agent — Database Schema v1.0
-- Run this in Supabase Dashboard → SQL Editor
--
-- 4 tables: sessions, plans, posts, connected_accounts
-- Eliminates: Bug 5 (content from DB), counter propagation (count from DB),
--             platforms fallback (accounts from DB), session persistence (future)

-- ============================================================
-- 1. SESSIONS — Interview data + business info
-- ============================================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT,
  business_info JSONB DEFAULT '{}',
  -- business_info stores: location, phone, hours, services, years, etc.
  interview_data JSONB DEFAULT '{}',
  -- interview_data stores: raw Q&A from the 10/15 question interview
  strategies TEXT[] DEFAULT '{}',
  -- Selected strategy IDs: ['educacion', 'comunidad', 'valor']
  status TEXT DEFAULT 'interview' CHECK (status IN ('interview', 'strategy', 'planning', 'active', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. PLANS — Marketing plans with post count and queue config
-- ============================================================
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  plan_name TEXT,
  description TEXT,
  post_count INTEGER NOT NULL DEFAULT 0,
  posts_published INTEGER NOT NULL DEFAULT 0,
  queue_slots JSONB DEFAULT '[]',
  -- queue_slots stores: [{"dayOfWeek": 1, "time": "12:00"}, ...]
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

-- ============================================================
-- 3. POSTS — Individual posts with content, image, and status
-- ============================================================
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  order_num INTEGER NOT NULL,
  -- order_num: 1-based position in the plan
  title TEXT,
  content TEXT,
  -- content: the actual post text (source of truth — eliminates Bug 5)
  image_prompt TEXT,
  image_model TEXT DEFAULT 'schnell',
  image_aspect_ratio TEXT DEFAULT '1:1',
  image_url TEXT,
  -- image_url: permanent URL from media.getlate.dev after presign upload
  late_draft_id TEXT,
  -- late_draft_id: Late.dev draft ID after createDraftPost
  late_post_id TEXT,
  -- late_post_id: Late.dev post ID after activateDraft
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'content_ready', 'image_ready', 'scheduled', 'published', 'failed')),
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. CONNECTED_ACCOUNTS — Social media accounts linked to session
-- ============================================================
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  -- account_id: Late.dev account _id
  username TEXT,
  page_id TEXT,
  -- page_id: for Facebook/LinkedIn pages
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, account_id)
);

-- ============================================================
-- INDEXES for common queries
-- ============================================================
CREATE INDEX idx_plans_session ON plans(session_id);
CREATE INDEX idx_posts_plan ON posts(plan_id);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_connected_accounts_session ON connected_accounts(session_id);

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
