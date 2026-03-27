import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const schemaSql = `
create table if not exists users (
  id text primary key,
  email text,
  display_name text,
  photo_url text,
  role text,
  is_admin boolean not null default false,
  unlimited_credits boolean not null default false,
  profile jsonb not null default '{}'::jsonb,
  entitlement jsonb not null default '{}'::jsonb,
  partner_link jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_unique_idx
  on users (lower(email))
  where email is not null;

create table if not exists places (
  id text primary key,
  google_place_id text,
  name text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  rating double precision,
  user_rating_count integer,
  owner_status text,
  owner_tier text,
  owner_ids text[] not null default '{}',
  facets jsonb not null default '{}'::jsonb,
  owner_content jsonb not null default '{}'::jsonb,
  refresh_state jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  last_refreshed_at timestamptz
);

create unique index if not exists places_google_place_id_unique_idx
  on places (google_place_id)
  where google_place_id is not null;

create index if not exists places_owner_status_idx on places (owner_status);

create table if not exists place_sources (
  place_id text not null references places(id) on delete cascade,
  source_key text not null,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz,
  primary key (place_id, source_key)
);

create table if not exists place_reports (
  id text primary key,
  place_id text not null references places(id) on delete cascade,
  user_id text references users(id) on delete set null,
  report_kind text not null,
  status text,
  payload jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists place_reports_place_id_idx on place_reports (place_id);
create index if not exists place_reports_report_kind_idx on place_reports (report_kind);

create table if not exists user_saved_places (
  user_id text not null references users(id) on delete cascade,
  place_id text not null references places(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists user_gamification_profiles (
  user_id text primary key references users(id) on delete cascade,
  level integer not null default 1,
  points integer not null default 0,
  streak_days integer not null default 0,
  badges jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists user_ai_usage_logs (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_ai_usage_logs_user_id_idx on user_ai_usage_logs (user_id);

create table if not exists partner_threads (
  id text primary key,
  status text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists partner_thread_members (
  thread_id text not null references partner_threads(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists partner_thread_notes (
  id text primary key,
  thread_id text not null references partner_threads(id) on delete cascade,
  author_user_id text references users(id) on delete set null,
  body text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists partner_thread_places (
  thread_id text not null references partner_threads(id) on delete cascade,
  place_id text not null references places(id) on delete cascade,
  added_by_user_id text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (thread_id, place_id)
);

create table if not exists partner_thread_memories (
  id text primary key,
  thread_id text not null references partner_threads(id) on delete cascade,
  author_user_id text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists circles (
  id text primary key,
  name text,
  join_code text,
  created_by text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create unique index if not exists circles_join_code_unique_idx
  on circles (join_code)
  where join_code is not null;

create table if not exists circle_members (
  circle_id text not null references circles(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists circle_places (
  circle_id text not null references circles(id) on delete cascade,
  place_id text not null references places(id) on delete cascade,
  added_by_user_id text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (circle_id, place_id)
);

create table if not exists circle_place_comments (
  id text primary key,
  circle_id text not null references circles(id) on delete cascade,
  place_id text not null references places(id) on delete cascade,
  user_id text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists circle_memories (
  id text primary key,
  circle_id text not null references circles(id) on delete cascade,
  user_id text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists place_claims (
  id text primary key,
  place_id text not null references places(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  status text not null,
  business_role text,
  business_email text,
  business_phone text,
  verification_method text,
  verification_evidence jsonb not null default '{}'::jsonb,
  rejection_reason text,
  reviewed_by text references users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists place_claims_place_id_idx on place_claims (place_id);
create index if not exists place_claims_user_id_idx on place_claims (user_id);
create index if not exists place_claims_status_idx on place_claims (status);

create table if not exists place_owner_profiles (
  id text primary key,
  place_id text not null references places(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  tier text,
  owner_content jsonb not null default '{}'::jsonb,
  paystack_reference text,
  paystack_subscription_code text,
  raw jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  last_updated_at timestamptz not null default now()
);

create unique index if not exists place_owner_profiles_place_user_unique_idx
  on place_owner_profiles (place_id, user_id);

create table if not exists reports (
  id text primary key,
  place_id text references places(id) on delete cascade,
  user_id text references users(id) on delete set null,
  status text,
  payload jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_place_id_idx on reports (place_id);
create index if not exists reports_user_id_idx on reports (user_id);
`;

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query(schemaSql);
  const result = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `);
  console.log('Bootstrap complete. Tables:');
  for (const row of result.rows) {
    console.log(`- ${row.table_name}`);
  }
} finally {
  await client.end();
}
