-- Enable UUID extension (not used for PKs but useful for join codes etc.)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USERS ────────────────────────────────────────────────────────────────────
-- Firebase UID is the primary key. Mirrors the Firestore users/{uid} document.
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,               -- Firebase UID
  email              TEXT,
  display_name       TEXT,
  photo_url          TEXT,
  role               TEXT DEFAULT 'user',
  is_admin           BOOLEAN DEFAULT FALSE,
  unlimited_credits  BOOLEAN DEFAULT FALSE,
  profile            JSONB DEFAULT '{}',             -- profileInfo, children, pets, preferences, accessibilityNeeds
  entitlement        JSONB DEFAULT '{}',             -- plan, ai_requests_this_month, ai_requests_reset_date, etc.
  partner_link       JSONB DEFAULT NULL,             -- partnerLink object
  settings           JSONB DEFAULT '{}',             -- darkMode, layoutMode, etc.
  raw                JSONB DEFAULT '{}',             -- full Firestore doc snapshot for reference during migration
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Add password_hash column for email/password auth (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ─── SAVED PLACES ─────────────────────────────────────────────────────────────
-- Mirrors users/{uid}/savedPlaces/{placeId} subcollection.
CREATE TABLE IF NOT EXISTS saved_places (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id           TEXT NOT NULL,
  place_name         TEXT,
  formatted_address  TEXT,
  rating             NUMERIC(3,1),
  saved_at           TIMESTAMPTZ DEFAULT now(),
  payload            JSONB DEFAULT '{}',             -- full SavedPlace + FavoriteData object
  place_raw          JSONB DEFAULT '{}',             -- Place object snapshot
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_places_user ON saved_places(user_id);

-- ─── CIRCLES ──────────────────────────────────────────────────────────────────
-- Mirrors circles/{circleId} collection.
CREATE TABLE IF NOT EXISTS circles (
  id                 TEXT PRIMARY KEY,               -- Firestore document ID preserved
  name               TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  join_code          TEXT UNIQUE,
  is_partner_circle  BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id          TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               TEXT DEFAULT 'member',         -- 'owner' | 'member'
  display_name       TEXT,
  email              TEXT,
  joined_at          TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);

CREATE TABLE IF NOT EXISTS circle_places (
  circle_id          TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  place_id           TEXT NOT NULL,
  saved_by_uid       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_by_name      TEXT,
  note               TEXT,
  place_summary      JSONB DEFAULT '{}',             -- {placeId, name, imageUrl, type, mapsUrl}
  saved_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (circle_id, place_id, saved_by_uid)
);
CREATE INDEX IF NOT EXISTS idx_circle_places_circle ON circle_places(circle_id);

CREATE TABLE IF NOT EXISTS circle_comments (
  id                 TEXT PRIMARY KEY,               -- Firestore doc ID or gen_random_uuid()::text
  circle_id          TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  place_id           TEXT NOT NULL,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name       TEXT,
  text               TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_circle_comments_place ON circle_comments(circle_id, place_id);

-- ─── PLACE CONTRIBUTIONS ──────────────────────────────────────────────────────
-- Mirrors places/{placeId}/accessibility, /familyFacilities, /petFriendly subcollections.
-- Consolidated into one table with a `contribution_type` discriminator.
CREATE TABLE IF NOT EXISTS place_contributions (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  place_id           TEXT NOT NULL,
  contribution_type  TEXT NOT NULL,                 -- 'accessibility' | 'family_facilities' | 'pet_friendly'
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  features           JSONB NOT NULL DEFAULT '[]',   -- array of {feature, value, confidence} objects
  summary            TEXT,
  visit_verified     BOOLEAN DEFAULT FALSE,
  moderation_status  TEXT DEFAULT 'pending',        -- 'pending' | 'approved' | 'rejected'
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (place_id, contribution_type, user_id)     -- one contribution per user per type per place
);
CREATE INDEX IF NOT EXISTS idx_contributions_place ON place_contributions(place_id, contribution_type);

-- ─── AI CREDITS (replaces Firebase Functions: reserveSmartInsightCredit) ──────
CREATE TABLE IF NOT EXISTS ai_credits (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  used               INTEGER DEFAULT 0,
  monthly_limit      INTEGER DEFAULT 10,            -- free tier default
  reset_month        TEXT,                          -- 'YYYY-MM' format
  last_used_at       TIMESTAMPTZ
);

-- ─── PLACE CLAIMS ─────────────────────────────────────────────────────────────
-- Already partially in server/index.ts — formalise the schema here.
CREATE TABLE IF NOT EXISTS place_claims (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  place_id             TEXT NOT NULL,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               TEXT DEFAULT 'pending',      -- 'pending' | 'approved' | 'rejected'
  business_role        TEXT,
  business_email       TEXT,
  business_phone       TEXT,
  verification_method  TEXT,
  verification_evidence JSONB DEFAULT '{}',
  rejection_reason     TEXT,
  reviewed_by          TEXT,
  place_name           TEXT,
  raw                  JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT now(),
  reviewed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_place_claims_user ON place_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_place_claims_place ON place_claims(place_id);

-- ─── COMMUNITY REPORTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_reports (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  place_id           TEXT,
  content_type       TEXT,                          -- 'place' | 'review' | 'contribution'
  content_id         TEXT,
  reported_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason             TEXT,
  details            TEXT,
  status             TEXT DEFAULT 'open',           -- 'open' | 'resolved' | 'dismissed'
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER contributions_updated_at
  BEFORE UPDATE ON place_contributions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
