import express, { Request, Response, NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import { createRequire } from 'module';
import crypto from 'crypto';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';
import { getExploreIntentDefinition, type ExploreIntentId } from './exploreIntentConfig.js';
import { closePostgresPool, isPostgresEnabled, pgHealthCheck, pgQuery } from './postgres.js';

const require = createRequire(import.meta.url);
const cors = require('cors/lib/index.js') as (options?: CorsOptions | CorsOptionsDelegate<Request>) => express.RequestHandler;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveFirstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const resolved = path.resolve(__dirname, '..', candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function loadEnvFiles(): string[] {
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const runtimeEnv = appEnv || (nodeEnv === 'production' ? 'production' : 'development');
  const loadPlanByEnv: Record<string, string[][]> = {
    development: [['.env.local', 'env.local'], ['.env.development', 'env.development'], ['.env', 'env']],
    staging: [['.env.staging', 'env.staging'], ['.env', 'env']],
    production: [['.env.production', 'env.production'], ['.env', 'env']],
  };
  const loadPlan = loadPlanByEnv[runtimeEnv] || loadPlanByEnv.development;

  const loaded: string[] = [];
  for (const candidates of loadPlan) {
    const envFile = resolveFirstExisting(candidates);
    if (!envFile) continue;
    const result = dotenv.config({ path: envFile, override: false, quiet: true });
    if (!result.error) {
      loaded.push(path.basename(envFile));
    }
  }
  return loaded;
}

const envFilesLoaded = loadEnvFiles();

const placesFromAlias = process.env.GOOGLE_PLACES_API_KEY || '';
if (!process.env.PLACES_API_KEY && placesFromAlias) {
  process.env.PLACES_API_KEY = placesFromAlias;
}
const PLACES_API_KEY = process.env.PLACES_API_KEY || '';

// Log startup immediately
console.log('[FamPal API] Starting server...');
console.log('[FamPal API] PORT env:', process.env.PORT);
console.log('[FamPal API] NODE_ENV:', process.env.NODE_ENV);

// Extend Express Request type to include verified user
interface AuthenticatedRequest extends Request {
  uid?: string;
}

type PostgresPlaceClaimRow = {
  id: string;
  place_id: string;
  user_id: string;
  status: string;
  business_role: string | null;
  business_email: string | null;
  business_phone: string | null;
  verification_method: string | null;
  verification_evidence: unknown;
  rejection_reason: string | null;
  reviewed_by: string | null;
  raw: unknown;
  created_at: Date | string | null;
  reviewed_at: Date | string | null;
  place_name?: string | null;
  user_email?: string | null;
  user_display_name?: string | null;
};

type PostgresUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  role: string | null;
  is_admin: boolean;
  unlimited_credits: boolean;
  profile: unknown;
  entitlement: unknown;
  partner_link: unknown;
  settings: unknown;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PostgresSavedPlaceRow = {
  place_id: string;
  saved_at: Date | string | null;
  payload: unknown;
  place_name: string | null;
  formatted_address: string | null;
  rating: number | null;
  place_raw: unknown;
};

type PostgresPartnerThreadRow = {
  id: string;
  status: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PostgresPartnerThreadNoteRow = {
  id: string;
  thread_id: string;
  author_user_id: string | null;
  body: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  author_display_name?: string | null;
  author_email?: string | null;
};

type PostgresPartnerThreadPlaceRow = {
  place_id: string;
  added_by_user_id: string | null;
  raw: unknown;
  created_at: Date | string | null;
};

type PostgresPartnerThreadMemoryRow = {
  id: string;
  author_user_id: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PostgresCircleRow = {
  id: string;
  name: string | null;
  join_code: string | null;
  created_by: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PostgresCircleMemberRow = {
  circle_id: string;
  user_id: string;
  role: string | null;
  raw: unknown;
  created_at: Date | string | null;
};

type PostgresCirclePlaceRow = {
  place_id: string;
  added_by_user_id: string | null;
  raw: unknown;
  created_at: Date | string | null;
};

type PostgresCircleCommentRow = {
  id: string;
  place_id: string;
  user_id: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type PostgresCircleMemoryRow = {
  id: string;
  user_id: string | null;
  raw: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

const CLIENT_WRITABLE_ENTITLEMENT_KEYS = new Set([
  'gemini_credits_used',
  'gemini_credits_limit',
  'usage_reset_month',
  'ai_requests_this_month',
  'ai_requests_reset_date',
]);

function isAdminAccessUser(userData: Record<string, any> | undefined): boolean {
  if (!userData) return false;
  const role = typeof userData.role === 'string' ? userData.role.toLowerCase() : '';
  const entitlementTier = typeof userData?.entitlement?.subscription_tier === 'string'
    ? String(userData.entitlement.subscription_tier).toLowerCase()
    : '';
  const topLevelEntitlement = typeof userData.entitlement === 'string'
    ? String(userData.entitlement).toLowerCase()
    : '';
  return role === 'admin'
    || entitlementTier === 'admin'
    || topLevelEntitlement === 'admin'
    || userData.unlimited_credits === true
    || userData.is_review_account === true;
}

const app = express();

// Health check endpoint - respond BEFORE any initialization or middleware
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

const replitDomains = process.env.REPLIT_DOMAINS?.split(',').map((domain) => domain.trim()).filter(Boolean) ?? [];
const replitOrigins = replitDomains.map((domain) => `https://${domain}`);
const configuredProdOrigin = (process.env.FRONTEND_PRODUCTION_ORIGIN || '').trim();
const configuredStagingOrigin = (process.env.FRONTEND_STAGING_ORIGIN || '').trim();
const allowedOrigins = [
  configuredProdOrigin,
  configuredStagingOrigin,
  'https://app.fampal.co.za',
  'https://staging.fampal.co.za',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
  'http://localhost:8080',
  ...replitOrigins,
].filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !PLACES_API_KEY) {
  console.warn('[FamPal API] PLACES_API_KEY is missing in production; places endpoints will remain unavailable until GOOGLE_PLACES_API_KEY or PLACES_API_KEY is configured.');
}
app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const GOOGLE_PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'co.fampal.app';
const GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS = (process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS || process.env.GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_ID || 'fampal_pro_monthly')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '';
const GOOGLE_PLAY_VERIFICATION_ENABLED = !!GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
const APP_URL = process.env.APP_URL
  || (replitDomains[0] ? `https://${replitDomains[0]}` : 'http://localhost:5000');
const GOOGLE_PLACES_API_KEY = PLACES_API_KEY;
const PLACES_CONFIGURED = !!GOOGLE_PLACES_API_KEY;
const PLACE_REFRESH_MAX_PER_RUN = Math.max(1, Number(process.env.PLACE_REFRESH_MAX_PER_RUN || 30));
const PLACE_REFRESH_CANDIDATE_MULTIPLIER = Math.max(2, Number(process.env.PLACE_REFRESH_CANDIDATE_MULTIPLIER || 4));
const PLACE_REFRESH_CONCURRENCY = Math.max(1, Number(process.env.PLACE_REFRESH_CONCURRENCY || 3));
const PLACE_REFRESH_CRON_TOKEN = process.env.PLACE_REFRESH_CRON_TOKEN || '';
const PLACES_REQUEST_TIMEOUT_MS = Math.min(8000, Math.max(3000, Number(process.env.PLACES_REQUEST_TIMEOUT_MS || 7000)));
const PLACES_SEARCH_CACHE_TTL_MS = Math.min(300000, Math.max(60000, Number(process.env.PLACES_SEARCH_CACHE_TTL_MS || 120000)));
const PLACES_DETAILS_CACHE_TTL_MS = Math.min(300000, Math.max(60000, Number(process.env.PLACES_DETAILS_CACHE_TTL_MS || 180000)));
const PLACES_CACHE_MAX_ENTRIES = Math.max(50, Number(process.env.PLACES_CACHE_MAX_ENTRIES || 400));

console.log('[FamPal API] Startup config:', {
  port: process.env.PORT || 8080,
  appEnv: process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  nodeEnv: process.env.NODE_ENV,
  envFilesLoaded,
  paystackConfigured: !!PAYSTACK_SECRET_KEY,
  playVerificationConfigured: GOOGLE_PLAY_VERIFICATION_ENABLED,
  placesConfigured: PLACES_CONFIGURED,
  placesTimeoutMs: PLACES_REQUEST_TIMEOUT_MS,
});

function getClientIp(req: Request): string {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length > 0) {
    return xfwd.split(',')[0].trim();
  }
  if (Array.isArray(xfwd) && xfwd.length > 0) {
    return xfwd[0];
  }
  return req.ip || 'unknown';
}

type RateConfig = { windowMs: number; max: number; label: string };
const rateStore = new Map<string, { count: number; resetAt: number }>();
function createIpRateLimiter(config: RateConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const key = `${config.label}:${ip}`;
    const current = rateStore.get(key);
    if (!current || current.resetAt <= now) {
      rateStore.set(key, { count: 1, resetAt: now + config.windowMs });
      return next();
    }
    if (current.count >= config.max) {
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }
    current.count += 1;
    rateStore.set(key, current);
    if (rateStore.size > 10000) {
      for (const [storeKey, state] of rateStore.entries()) {
        if (state.resetAt <= now) rateStore.delete(storeKey);
      }
    }
    return next();
  };
}

type CacheEntry = { expiresAt: number; body: string };
const responseCache = new Map<string, CacheEntry>();
function buildSortedQueryKey(query: Request['query']): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const params = new URLSearchParams(entries as [string, string][]);
  return params.toString();
}
function createJsonCache(ttlMs: number, label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    const cacheKey = `${label}:${req.path}?${buildSortedQueryKey(req.query)}`;
    const now = Date.now();
    const hit = responseCache.get(cacheKey);
    if (hit && hit.expiresAt > now) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.type('application/json').send(hit.body);
    }
    const originalJson = res.json.bind(res);
    res.json = ((payload: any) => {
      try {
        const body = JSON.stringify(payload);
        responseCache.set(cacheKey, { expiresAt: now + ttlMs, body });
        if (responseCache.size > PLACES_CACHE_MAX_ENTRIES) {
          const oldest = responseCache.keys().next().value;
          if (oldest) responseCache.delete(oldest);
        }
        res.setHeader('X-Cache', 'MISS');
      } catch {
        // no-op
      }
      return originalJson(payload);
    }) as typeof res.json;
    return next();
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs: number = PLACES_REQUEST_TIMEOUT_MS): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

app.use('/api/places', (req, res, next) => {
  const start = Date.now();
  const route = req.path;
  res.on('finish', () => {
    console.log('[FamPal Places] request', {
      route,
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// Initialize Firebase Admin SDK
// In production on Cloud Run/App Hosting, uses Application Default Credentials (ADC)
// Can also use FIREBASE_SERVICE_ACCOUNT if explicitly provided
let db: ReturnType<typeof getFirestore>;
let adminAuth: ReturnType<typeof getAuth>;

try {
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({ credential: cert(serviceAccount) });
      console.log('[FamPal API] Initialized with explicit service account');
    } else {
      // Use ADC (works on Cloud Run, App Engine, Cloud Functions)
      initializeApp();
      console.log('[FamPal API] Initialized with Application Default Credentials');
    }
  }
  db = getFirestore();
  adminAuth = getAuth();
  console.log('[FamPal API] Firebase Admin SDK initialized successfully');
} catch (err) {
  console.error('[FamPal API] Firebase Admin init error:', err);
  process.exit(1);
}

function parsePgJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isRecord(value)) {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch {
        return undefined;
      }
    }
    if (typeof value.toMillis === 'function') {
      try {
        return new Date(value.toMillis()).toISOString();
      } catch {
        return undefined;
      }
    }
    const cleaned: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      const next = stripUndefinedDeep(entry);
      if (next !== undefined) {
        cleaned[key] = next;
      }
    });
    return cleaned;
  }
  return value;
}

function mergeNestedRecord(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      delete result[key];
      return;
    }
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = mergeNestedRecord(result[key], value);
      return;
    }
    result[key] = value;
  });
  return result;
}

function sanitizeClientEntitlementPatch(value: unknown): Record<string, any> {
  if (!isRecord(value)) return {};
  const patch: Record<string, any> = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (!CLIENT_WRITABLE_ENTITLEMENT_KEYS.has(key)) return;
    const cleaned = stripUndefinedDeep(entry);
    if (cleaned !== undefined) {
      patch[key] = cleaned;
    }
  });
  return patch;
}

function mapPostgresUserState(row: PostgresUserRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  const settings = parsePgJson<Record<string, any>>(row.settings, {});
  const entitlement = parsePgJson<Record<string, any>>(row.entitlement, {});
  const partnerLink = parsePgJson<Record<string, any>>(row.partner_link, {});
  const profile = parsePgJson<Record<string, any>>(row.profile, {});

  const response: Record<string, any> = { ...raw };
  if (Object.keys(settings.userPreferences || {}).length > 0) {
    response.userPreferences = settings.userPreferences;
  }
  if (Object.keys(entitlement).length > 0) {
    response.entitlement = entitlement;
  }
  if (Object.keys(partnerLink).length > 0) {
    response.partnerLink = partnerLink;
  }
  if (Object.keys(profile).length > 0) {
    response.profile = profile;
  }
  if (row.role) {
    response.role = row.role;
  }
  if (row.is_admin) {
    response.isAdmin = true;
  }
  if (row.unlimited_credits) {
    response.unlimited_credits = true;
  }
  return response;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getPostgresUserRow(userId: string): Promise<PostgresUserRow | null> {
  const result = await pgQuery<PostgresUserRow>(
    `
      select *
      from users
      where id = $1
      limit 1
    `,
    [userId],
  );
  return result.rows[0] || null;
}

async function ensurePostgresUserRow(userId: string): Promise<PostgresUserRow> {
  const existing = await getPostgresUserRow(userId);
  if (existing) return existing;
  await ensurePostgresUser(userId);
  const created = await getPostgresUserRow(userId);
  if (!created) {
    throw new Error('postgres_user_upsert_failed');
  }
  return created;
}

async function ensurePostgresUser(userId: string): Promise<{ email: string; displayName: string | null }> {
  const userRecord = await adminAuth.getUser(userId);
  await pgQuery(
    `
      insert into users (id, email, display_name, photo_url, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (id) do update
      set email = excluded.email,
          display_name = coalesce(excluded.display_name, users.display_name),
          photo_url = coalesce(excluded.photo_url, users.photo_url),
          updated_at = now()
    `,
    [userId, userRecord.email || null, userRecord.displayName || null, userRecord.photoURL || null],
  );
  return {
    email: userRecord.email || '',
    displayName: userRecord.displayName || null,
  };
}

async function ensurePostgresPlace(placeId: string, placeName: string): Promise<void> {
  await pgQuery(
    `
      insert into places (id, name, owner_status, raw, created_at, updated_at)
      values ($1, $2, 'none', '{}'::jsonb, now(), now())
      on conflict (id) do update
      set name = coalesce(nullif(excluded.name, ''), places.name),
          updated_at = now()
    `,
    [placeId, placeName || null],
  );
}

async function loadUserState(userId: string): Promise<Record<string, any> | null> {
  if (isPostgresEnabled) {
    const row = await ensurePostgresUserRow(userId);
    return mapPostgresUserState(row);
  }

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  return userDoc.data() || null;
}

async function upsertUserProfileData(userId: string, profile: Record<string, any>): Promise<void> {
  const cleanedProfile = stripUndefinedDeep(profile);
  if (isPostgresEnabled) {
    const currentRow = await ensurePostgresUserRow(userId);
    const currentProfile = parsePgJson<Record<string, any>>(currentRow?.profile, {});
    const currentRaw = parsePgJson<Record<string, any>>(currentRow?.raw, {});
    const nextProfile = mergeNestedRecord(currentProfile, isRecord(cleanedProfile) ? cleanedProfile : {});
    const nextRaw = {
      ...currentRaw,
      lastLoginAt: new Date().toISOString(),
    };

    await pgQuery(
      `
        update users
        set profile = $2::jsonb,
            raw = $3::jsonb,
            updated_at = now()
        where id = $1
      `,
      [userId, JSON.stringify(nextProfile), JSON.stringify(nextRaw)],
    );
    return;
  }

  await db.collection('users').doc(userId).set({
    profile: cleanedProfile || {},
    lastLoginAt: new Date().toISOString(),
  }, { merge: true });
}

async function saveUserFieldData(userId: string, key: string, value: unknown): Promise<void> {
  const cleanedValue = key === 'entitlement'
    ? sanitizeClientEntitlementPatch(value)
    : stripUndefinedDeep(value);

  if (isPostgresEnabled) {
    const currentRow = await ensurePostgresUserRow(userId);
    const nextProfile = parsePgJson<Record<string, any>>(currentRow?.profile, {});
    const nextEntitlement = parsePgJson<Record<string, any>>(currentRow?.entitlement, {});
    const nextPartnerLink = parsePgJson<Record<string, any>>(currentRow?.partner_link, {});
    const nextSettings = parsePgJson<Record<string, any>>(currentRow?.settings, {});
    const nextRaw = parsePgJson<Record<string, any>>(currentRow?.raw, {});

    if (key === 'entitlement') {
      const patch = isRecord(cleanedValue) ? cleanedValue : {};
      Object.assign(nextEntitlement, mergeNestedRecord(nextEntitlement, patch));
    } else if (key === 'partnerLink') {
      const patch = isRecord(cleanedValue) ? cleanedValue : {};
      Object.keys(nextPartnerLink).forEach((field) => delete nextPartnerLink[field]);
      Object.assign(nextPartnerLink, patch);
    } else if (key === 'userPreferences') {
      const existingPrefs = isRecord(nextSettings.userPreferences) ? nextSettings.userPreferences : {};
      if (cleanedValue === undefined) {
        delete nextSettings.userPreferences;
      } else if (isRecord(cleanedValue)) {
        nextSettings.userPreferences = mergeNestedRecord(existingPrefs, cleanedValue);
      } else {
        nextSettings.userPreferences = cleanedValue;
      }
    } else if (key === 'profile') {
      const patch = isRecord(cleanedValue) ? cleanedValue : {};
      Object.assign(nextProfile, mergeNestedRecord(nextProfile, patch));
    } else if (cleanedValue === undefined) {
      delete nextRaw[key];
    } else {
      nextRaw[key] = cleanedValue;
    }

    await pgQuery(
      `
        update users
        set profile = $2::jsonb,
            entitlement = $3::jsonb,
            partner_link = $4::jsonb,
            settings = $5::jsonb,
            raw = $6::jsonb,
            updated_at = now()
        where id = $1
      `,
      [
        userId,
        JSON.stringify(nextProfile),
        JSON.stringify(nextEntitlement),
        JSON.stringify(nextPartnerLink),
        JSON.stringify(nextSettings),
        JSON.stringify(nextRaw),
      ],
    );
    return;
  }

  const payload: Record<string, any> = {};
  payload[key] = cleanedValue === undefined ? FieldValue.delete() : cleanedValue;
  await db.collection('users').doc(userId).set(payload, { merge: true });
}

async function setUserEntitlementData(userId: string, entitlement: Record<string, any>): Promise<void> {
  const cleanedEntitlement = stripUndefinedDeep(entitlement);
  if (isPostgresEnabled) {
    const currentRow = await ensurePostgresUserRow(userId);
    const nextProfile = parsePgJson<Record<string, any>>(currentRow.profile, {});
    const nextPartnerLink = parsePgJson<Record<string, any>>(currentRow.partner_link, {});
    const nextSettings = parsePgJson<Record<string, any>>(currentRow.settings, {});
    const nextRaw = parsePgJson<Record<string, any>>(currentRow.raw, {});
    await pgQuery(
      `
        update users
        set profile = $2::jsonb,
            entitlement = $3::jsonb,
            partner_link = $4::jsonb,
            settings = $5::jsonb,
            raw = $6::jsonb,
            updated_at = now()
        where id = $1
      `,
      [
        userId,
        JSON.stringify(nextProfile),
        JSON.stringify(isRecord(cleanedEntitlement) ? cleanedEntitlement : {}),
        JSON.stringify(nextPartnerLink),
        JSON.stringify(nextSettings),
        JSON.stringify(nextRaw),
      ],
    );
    return;
  }

  await db.collection('users').doc(userId).set({
    entitlement: cleanedEntitlement || {},
  }, { merge: true });
}

function mapPostgresSavedPlace(row: PostgresSavedPlaceRow): Record<string, any> {
  const payload = parsePgJson<Record<string, any>>(row.payload, {});
  const placeRaw = parsePgJson<Record<string, any>>(row.place_raw, {});
  return stripUndefinedDeep({
    placeId: row.place_id,
    name: payload.name || row.place_name || 'Saved place',
    address: payload.address || row.formatted_address || '',
    imageUrl: payload.imageUrl || placeRaw.photoUrl || null,
    mapsUrl: payload.mapsUrl || placeRaw.mapsUrl || placeRaw.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${row.place_id}`,
    rating: payload.rating ?? row.rating ?? placeRaw.rating,
    priceLevel: payload.priceLevel || placeRaw.priceLevel,
    tags: payload.tags || placeRaw.tags,
    type: payload.type || placeRaw.type,
    description: payload.description || placeRaw.description,
    savedAt: toIsoString(row.saved_at),
  }) as Record<string, any>;
}

async function listSavedPlaces(userId: string): Promise<Record<string, any>[]> {
  if (isPostgresEnabled) {
    await ensurePostgresUserRow(userId);
    const result = await pgQuery<PostgresSavedPlaceRow>(
      `
        select
          usp.place_id,
          usp.saved_at,
          usp.payload,
          p.name as place_name,
          p.formatted_address,
          p.rating,
          p.raw as place_raw
        from user_saved_places usp
        left join places p on p.id = usp.place_id
        where usp.user_id = $1
        order by usp.saved_at desc
      `,
      [userId],
    );
    return result.rows.map(mapPostgresSavedPlace);
  }

  const snap = await db.collection('users').doc(userId).collection('savedPlaces').get();
  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        placeId: data.placeId || docSnap.id,
        ...data,
      } as Record<string, any>;
    })
    .sort((a: Record<string, any>, b: Record<string, any>) => {
      const aMs = toIsoString(a.savedAt) ? Date.parse(String(toIsoString(a.savedAt))) : 0;
      const bMs = toIsoString(b.savedAt) ? Date.parse(String(toIsoString(b.savedAt))) : 0;
      return bMs - aMs;
    });
}

async function upsertSavedPlaceData(userId: string, place: Record<string, any>): Promise<void> {
  const cleanedPlace = stripUndefinedDeep(place);
  const placeId = typeof cleanedPlace === 'object' && cleanedPlace && 'placeId' in cleanedPlace
    ? String((cleanedPlace as Record<string, any>).placeId || '').trim()
    : '';
  if (!placeId) {
    throw new Error('place_id_required');
  }

  if (isPostgresEnabled) {
    await ensurePostgresUserRow(userId);
    const data = isRecord(cleanedPlace) ? cleanedPlace : {};
    const placeRaw = stripUndefinedDeep({
      photoUrl: data.imageUrl,
      mapsUrl: data.mapsUrl,
      priceLevel: data.priceLevel,
      tags: data.tags,
      type: data.type,
      description: data.description,
      rating: data.rating,
    }) || {};
    const savedAtIso = typeof data.savedAt === 'string'
      ? data.savedAt
      : toIsoString(data.savedAt) || new Date().toISOString();

    await pgQuery(
      `
        insert into places (id, name, formatted_address, rating, owner_status, raw, created_at, updated_at)
        values ($1, $2, $3, $4, 'none', $5::jsonb, now(), now())
        on conflict (id) do update
        set name = coalesce(excluded.name, places.name),
            formatted_address = coalesce(excluded.formatted_address, places.formatted_address),
            rating = coalesce(excluded.rating, places.rating),
            raw = places.raw || excluded.raw,
            updated_at = now()
      `,
      [
        placeId,
        typeof data.name === 'string' ? data.name : null,
        typeof data.address === 'string' ? data.address : null,
        typeof data.rating === 'number' ? data.rating : null,
        JSON.stringify(placeRaw),
      ],
    );

    await pgQuery(
      `
        insert into user_saved_places (user_id, place_id, payload, saved_at)
        values ($1, $2, $3::jsonb, $4::timestamptz)
        on conflict (user_id, place_id) do update
        set payload = excluded.payload,
            saved_at = excluded.saved_at
      `,
      [userId, placeId, JSON.stringify(data), savedAtIso],
    );
    return;
  }

  await db.collection('users').doc(userId).collection('savedPlaces').doc(placeId).set(cleanedPlace || {}, { merge: true });
}

async function deleteSavedPlaceData(userId: string, placeId: string): Promise<void> {
  if (isPostgresEnabled) {
    await pgQuery(
      `
        delete from user_saved_places
        where user_id = $1 and place_id = $2
      `,
      [userId, placeId],
    );
    return;
  }

  await db.collection('users').doc(userId).collection('savedPlaces').doc(placeId).delete();
}

function getPartnerThreadIdForUsers(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join('_');
}

function getUserProfileSnapshot(row: PostgresUserRow): { displayName: string | null; email: string | null; photoURL: string | null } {
  const profile = parsePgJson<Record<string, any>>(row.profile, {});
  return {
    displayName: row.display_name || profile.displayName || null,
    email: row.email || profile.email || null,
    photoURL: row.photo_url || profile.photoURL || null,
  };
}

async function getUserPartnerLink(userId: string): Promise<Record<string, any> | null> {
  if (isPostgresEnabled) {
    const row = await ensurePostgresUserRow(userId);
    const partnerLink = parsePgJson<Record<string, any>>(row.partner_link, {});
    return Object.keys(partnerLink).length > 0 ? partnerLink : null;
  }

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  const userData = userDoc.data() || {};
  return userData.partnerLink ? { ...userData.partnerLink } : null;
}

async function hydratePartnerLink(partnerLink: Record<string, any> | null): Promise<Record<string, any> | null> {
  if (!partnerLink?.partnerUserId) return partnerLink;

  if (isPostgresEnabled) {
    const partnerRow = await ensurePostgresUserRow(String(partnerLink.partnerUserId));
    const partnerProfile = getUserProfileSnapshot(partnerRow);
    return {
      ...partnerLink,
      partnerName: partnerLink.partnerName || partnerProfile.displayName || partnerProfile.email || 'Partner',
      partnerEmail: partnerLink.partnerEmail || partnerProfile.email || undefined,
      partnerPhotoURL: partnerLink.partnerPhotoURL || partnerProfile.photoURL || undefined,
    };
  }

  const partnerDoc = await db.collection('users').doc(String(partnerLink.partnerUserId)).get();
  if (!partnerDoc.exists) return partnerLink;
  const partnerData = partnerDoc.data() || {};
  const partnerProfile = partnerData.profile || {};
  return {
    ...partnerLink,
    partnerName: partnerLink.partnerName || partnerProfile.displayName || partnerProfile.email || 'Partner',
    partnerEmail: partnerLink.partnerEmail || partnerProfile.email || undefined,
    partnerPhotoURL: partnerLink.partnerPhotoURL || partnerProfile.photoURL || undefined,
  };
}

async function findPartnerByInviteCode(inviteCode: string, excludingUserId: string): Promise<{ id: string; partnerLink: Record<string, any>; profile: { displayName: string | null; email: string | null; photoURL: string | null } } | null> {
  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresUserRow>(
      `
        select *
        from users
        where upper(coalesce(partner_link->>'inviteCode', '')) = upper($1)
          and id <> $2
        limit 1
      `,
      [inviteCode, excludingUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      partnerLink: parsePgJson<Record<string, any>>(row.partner_link, {}),
      profile: getUserProfileSnapshot(row),
    };
  }

  const snap = await db.collection('users')
    .where('partnerLink.inviteCode', '==', inviteCode)
    .get();
  const match = snap.docs.find((docSnap) => docSnap.id !== excludingUserId);
  if (!match) return null;
  const partnerData = match.data() || {};
  const partnerProfile = partnerData.profile || {};
  return {
    id: match.id,
    partnerLink: partnerData.partnerLink || {},
    profile: {
      displayName: partnerProfile.displayName || null,
      email: partnerProfile.email || null,
      photoURL: partnerProfile.photoURL || null,
    },
  };
}

async function ensurePartnerThreadRecord(userId: string, partnerUserId: string): Promise<string> {
  const threadId = getPartnerThreadIdForUsers(userId, partnerUserId);

  if (isPostgresEnabled) {
    await pgQuery(
      `
        insert into partner_threads (id, status, raw, created_at, updated_at)
        values ($1, 'active', '{}'::jsonb, now(), now())
        on conflict (id) do update
        set status = 'active',
            updated_at = now()
      `,
      [threadId],
    );

    await pgQuery(
      `
        insert into partner_thread_members (thread_id, user_id, role, raw, created_at)
        values
          ($1, $2, 'member', '{}'::jsonb, now()),
          ($1, $3, 'member', '{}'::jsonb, now())
        on conflict (thread_id, user_id) do update
        set role = excluded.role
      `,
      [threadId, userId, partnerUserId],
    );

    return threadId;
  }

  const threadRef = db.collection('partnerThreads').doc(threadId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    await threadRef.set({
      members: [userId, partnerUserId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
  } else if ((threadSnap.data() || {}).status === 'closed') {
    await threadRef.set({ status: 'active', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return threadId;
}

function mapPartnerThreadNote(row: PostgresPartnerThreadNoteRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    text: row.body || raw.text || '',
    createdAt: raw.createdAt || toIsoString(row.created_at) || new Date().toISOString(),
    createdBy: row.author_user_id || raw.createdBy || '',
    createdByName: raw.createdByName || row.author_display_name || row.author_email || 'Partner',
  };
}

function mapPartnerThreadPlace(row: PostgresPartnerThreadPlaceRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    ...raw,
    placeId: raw.placeId || row.place_id,
    addedBy: raw.addedBy || row.added_by_user_id || '',
    addedAt: raw.addedAt || toIsoString(row.created_at) || new Date().toISOString(),
  };
}

function mapPartnerThreadMemory(row: PostgresPartnerThreadMemoryRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    ...raw,
    date: raw.date || toIsoString(row.created_at) || new Date().toISOString(),
  };
}

async function loadPartnerThreadState(userId: string): Promise<{
  partnerLink: Record<string, any> | null;
  notes: Record<string, any>[];
  sharedPlaces: Record<string, any>[];
  sharedMemories: Record<string, any>[];
  familyPool: Record<string, any> | null;
}> {
  const partnerLink = await hydratePartnerLink(await getUserPartnerLink(userId));
  if (!partnerLink?.partnerUserId || partnerLink.status !== 'accepted') {
    return {
      partnerLink,
      notes: [],
      sharedPlaces: [],
      sharedMemories: [],
      familyPool: null,
    };
  }

  const threadId = await ensurePartnerThreadRecord(userId, String(partnerLink.partnerUserId));

  if (isPostgresEnabled) {
    const [threadResult, notesResult, placesResult, memoriesResult] = await Promise.all([
      pgQuery<PostgresPartnerThreadRow>(
        `select * from partner_threads where id = $1 limit 1`,
        [threadId],
      ),
      pgQuery<PostgresPartnerThreadNoteRow>(
        `
          select
            n.*,
            u.display_name as author_display_name,
            u.email as author_email
          from partner_thread_notes n
          left join users u on u.id = n.author_user_id
          where n.thread_id = $1
          order by n.created_at asc
        `,
        [threadId],
      ),
      pgQuery<PostgresPartnerThreadPlaceRow>(
        `
          select *
          from partner_thread_places
          where thread_id = $1
          order by created_at desc
        `,
        [threadId],
      ),
      pgQuery<PostgresPartnerThreadMemoryRow>(
        `
          select *
          from partner_thread_memories
          where thread_id = $1
          order by created_at desc
        `,
        [threadId],
      ),
    ]);

    const threadRaw = parsePgJson<Record<string, any>>(threadResult.rows[0]?.raw, {});
    return {
      partnerLink,
      notes: notesResult.rows.map(mapPartnerThreadNote),
      sharedPlaces: placesResult.rows.map(mapPartnerThreadPlace),
      sharedMemories: memoriesResult.rows.map(mapPartnerThreadMemory),
      familyPool: isRecord(threadRaw.entitlementPool) ? threadRaw.entitlementPool : null,
    };
  }

  const threadRef = db.collection('partnerThreads').doc(threadId);
  const [threadDoc, notesSnap, placesSnap, memoriesSnap] = await Promise.all([
    threadRef.get(),
    threadRef.collection('notes').get(),
    threadRef.collection('sharedPlaces').get(),
    threadRef.collection('sharedMemories').get(),
  ]);

  const threadData = threadDoc.exists ? (threadDoc.data() || {}) : {};
  return {
    partnerLink,
    notes: notesSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }) as Record<string, any>)
      .sort((a: Record<string, any>, b: Record<string, any>) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
    sharedPlaces: placesSnap.docs
      .map((docSnap) => (docSnap.data() || {}) as Record<string, any>)
      .sort((a: Record<string, any>, b: Record<string, any>) => String(b.addedAt || '').localeCompare(String(a.addedAt || ''))),
    sharedMemories: memoriesSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }) as Record<string, any>)
      .sort((a: Record<string, any>, b: Record<string, any>) => String(b.date || '').localeCompare(String(a.date || ''))),
    familyPool: isRecord(threadData.entitlementPool) ? threadData.entitlementPool : null,
  };
}

async function savePartnerThreadNote(userId: string, text: string, createdByName: string): Promise<Record<string, any>> {
  const partnerLink = await getUserPartnerLink(userId);
  if (!partnerLink?.partnerUserId || partnerLink.status !== 'accepted') {
    throw new Error('partner_not_linked');
  }
  const threadId = await ensurePartnerThreadRecord(userId, String(partnerLink.partnerUserId));
  const note = {
    id: `${Date.now()}`,
    text,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    createdByName,
  };

  if (isPostgresEnabled) {
    await pgQuery(
      `
        insert into partner_thread_notes (id, thread_id, author_user_id, body, raw, created_at, updated_at)
        values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, now())
      `,
      [note.id, threadId, userId, note.text, JSON.stringify(note), note.createdAt],
    );
    await pgQuery(
      `update partner_threads set updated_at = now() where id = $1`,
      [threadId],
    );
    return note;
  }

  await db.collection('partnerThreads').doc(threadId).collection('notes').doc(note.id).set(note);
  await db.collection('partnerThreads').doc(threadId).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return note;
}

async function savePartnerThreadPlace(userId: string, placeId: string, place: Record<string, any>): Promise<void> {
  const partnerLink = await getUserPartnerLink(userId);
  if (!partnerLink?.partnerUserId || partnerLink.status !== 'accepted') {
    throw new Error('partner_not_linked');
  }
  const threadId = await ensurePartnerThreadRecord(userId, String(partnerLink.partnerUserId));
  const payload = stripUndefinedDeep({ ...place, placeId }) || {};

  if (isPostgresEnabled) {
    await ensurePostgresUserRow(userId);
    await ensurePostgresPlace(placeId, String((payload as Record<string, any>).placeName || (payload as Record<string, any>).name || 'Shared place'));
    await pgQuery(
      `
        insert into partner_thread_places (thread_id, place_id, added_by_user_id, raw, created_at)
        values ($1, $2, $3, $4::jsonb, now())
        on conflict (thread_id, place_id) do update
        set raw = excluded.raw,
            added_by_user_id = excluded.added_by_user_id
      `,
      [threadId, placeId, userId, JSON.stringify(payload)],
    );
    await pgQuery(
      `update partner_threads set updated_at = now() where id = $1`,
      [threadId],
    );
    return;
  }

  await db.collection('partnerThreads').doc(threadId).collection('sharedPlaces').doc(placeId).set(payload, { merge: true });
  await db.collection('partnerThreads').doc(threadId).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function savePartnerThreadMemory(userId: string, memoryId: string, memory: Record<string, any>): Promise<void> {
  const partnerLink = await getUserPartnerLink(userId);
  if (!partnerLink?.partnerUserId || partnerLink.status !== 'accepted') {
    throw new Error('partner_not_linked');
  }
  const threadId = await ensurePartnerThreadRecord(userId, String(partnerLink.partnerUserId));
  const payload = stripUndefinedDeep(memory) || {};

  if (isPostgresEnabled) {
    await pgQuery(
      `
        insert into partner_thread_memories (id, thread_id, author_user_id, raw, created_at, updated_at)
        values ($1, $2, $3, $4::jsonb, now(), now())
        on conflict (id) do update
        set raw = excluded.raw,
            updated_at = now()
      `,
      [memoryId, threadId, userId, JSON.stringify(payload)],
    );
    await pgQuery(
      `update partner_threads set updated_at = now() where id = $1`,
      [threadId],
    );
    return;
  }

  await db.collection('partnerThreads').doc(threadId).collection('sharedMemories').doc(memoryId).set(payload, { merge: true });
  await db.collection('partnerThreads').doc(threadId).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function savePartnerThreadFamilyPool(userId: string, familyPool: Record<string, any>): Promise<Record<string, any>> {
  const partnerLink = await getUserPartnerLink(userId);
  if (!partnerLink?.partnerUserId || partnerLink.status !== 'accepted') {
    throw new Error('partner_not_linked');
  }
  const threadId = await ensurePartnerThreadRecord(userId, String(partnerLink.partnerUserId));
  const cleanedPool = stripUndefinedDeep(familyPool);
  const nextPool = isRecord(cleanedPool) ? cleanedPool : {};

  if (isPostgresEnabled) {
    const threadResult = await pgQuery<PostgresPartnerThreadRow>(
      `select * from partner_threads where id = $1 limit 1`,
      [threadId],
    );
    const currentRaw = parsePgJson<Record<string, any>>(threadResult.rows[0]?.raw, {});
    const mergedRaw = {
      ...currentRaw,
      entitlementPool: mergeNestedRecord(isRecord(currentRaw.entitlementPool) ? currentRaw.entitlementPool : {}, nextPool),
    };
    await pgQuery(
      `
        update partner_threads
        set raw = $2::jsonb,
            updated_at = now()
        where id = $1
      `,
      [threadId, JSON.stringify(mergedRaw)],
    );
    return mergedRaw.entitlementPool;
  }

  await db.collection('partnerThreads').doc(threadId).set({
    entitlementPool: nextPool,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return nextPool;
}

function generateCircleJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function mapCircle(row: PostgresCircleRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    name: row.name || raw.name || 'Circle',
    createdBy: row.created_by || raw.createdBy || '',
    createdAt: raw.createdAt || toIsoString(row.created_at) || new Date().toISOString(),
    joinCode: row.join_code || raw.joinCode || '',
    isPartnerCircle: raw.isPartnerCircle === true,
  };
}

function mapCircleMember(row: PostgresCircleMemberRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    uid: row.user_id,
    role: (row.role || raw.role || 'member') as 'owner' | 'member',
    displayName: raw.displayName || undefined,
    email: raw.email || undefined,
    joinedAt: raw.joinedAt || toIsoString(row.created_at) || new Date().toISOString(),
  };
}

function mapCirclePlace(row: PostgresCirclePlaceRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    ...raw,
    placeId: raw.placeId || row.place_id,
    savedByUid: raw.savedByUid || row.added_by_user_id || '',
    savedAt: raw.savedAt || toIsoString(row.created_at) || new Date().toISOString(),
  };
}

function mapCircleComment(row: PostgresCircleCommentRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    placeId: raw.placeId || row.place_id,
    uid: raw.uid || row.user_id || '',
    text: raw.text || '',
    createdAt: raw.createdAt || toIsoString(row.created_at) || new Date().toISOString(),
    displayName: raw.displayName || undefined,
  };
}

function mapCircleMemory(row: PostgresCircleMemoryRow): Record<string, any> {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    ...raw,
    memoryId: raw.memoryId || row.id,
    createdAt: raw.createdAt || toIsoString(row.created_at) || new Date().toISOString(),
    createdByUid: raw.createdByUid || row.user_id || '',
  };
}

async function isCircleMember(circleId: string, userId: string): Promise<boolean> {
  if (isPostgresEnabled) {
    const result = await pgQuery<{ exists: number }>(
      `
        select 1 as exists
        from circle_members
        where circle_id = $1 and user_id = $2
        limit 1
      `,
      [circleId, userId],
    );
    return !!result.rowCount;
  }

  const memberDoc = await db.collection('circles').doc(circleId).collection('members').doc(userId).get();
  return memberDoc.exists;
}

async function getCircleByJoinCode(joinCode: string): Promise<PostgresCircleRow | null> {
  const result = await pgQuery<PostgresCircleRow>(
    `
      select *
      from circles
      where upper(coalesce(join_code, '')) = upper($1)
      limit 1
    `,
    [joinCode],
  );
  return result.rows[0] || null;
}

async function listUserCirclesData(userId: string): Promise<Record<string, any>[]> {
  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleRow>(
      `
        select c.*
        from circle_members cm
        join circles c on c.id = cm.circle_id
        where cm.user_id = $1
        order by c.created_at desc nulls last
      `,
      [userId],
    );
    return result.rows.map(mapCircle);
  }

  const membersSnap = await db.collectionGroup('members').where('uid', '==', userId).get();
  const circleDocs = await Promise.all(
    membersSnap.docs.map(async (memberDoc) => {
      const circleRef = memberDoc.ref.parent.parent;
      if (!circleRef) return null;
      const circleSnap = await circleRef.get();
      if (!circleSnap.exists) return null;
      const data = circleSnap.data() || {};
      return {
        id: circleSnap.id,
        name: data.name,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        joinCode: data.joinCode,
        isPartnerCircle: data.isPartnerCircle || false,
      };
    }),
  );
  return circleDocs.filter(Boolean) as Record<string, any>[];
}

async function createCircleData(
  userId: string,
  name: string,
  owner: { displayName?: string | null; email?: string | null },
  options?: { isPartnerCircle?: boolean; partner?: { uid: string; displayName?: string | null; email?: string | null } | null },
): Promise<Record<string, any>> {
  const joinCode = generateCircleJoinCode();
  const createdAt = new Date().toISOString();
  const isPartnerCircle = options?.isPartnerCircle === true;

  if (isPostgresEnabled) {
    await ensurePostgresUserRow(userId);
    const circleId = crypto.randomUUID();
    const raw = {
      name,
      createdBy: userId,
      createdAt,
      joinCode,
      isPartnerCircle,
    };
    await pgQuery(
      `
        insert into circles (id, name, join_code, created_by, raw, created_at, updated_at)
        values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, now())
      `,
      [circleId, name, joinCode, userId, JSON.stringify(raw), createdAt],
    );
    await pgQuery(
      `
        insert into circle_members (circle_id, user_id, role, raw, created_at)
        values ($1, $2, 'owner', $3::jsonb, $4::timestamptz)
      `,
      [circleId, userId, JSON.stringify({
        uid: userId,
        role: 'owner',
        displayName: owner.displayName || undefined,
        email: owner.email || undefined,
        joinedAt: createdAt,
      }), createdAt],
    );

    if (options?.partner?.uid) {
      await ensurePostgresUserRow(options.partner.uid);
      await pgQuery(
        `
          insert into circle_members (circle_id, user_id, role, raw, created_at)
          values ($1, $2, 'member', $3::jsonb, $4::timestamptz)
        `,
        [circleId, options.partner.uid, JSON.stringify({
          uid: options.partner.uid,
          role: 'member',
          displayName: options.partner.displayName || undefined,
          email: options.partner.email || undefined,
          joinedAt: createdAt,
        }), createdAt],
      );
    }

    return {
      id: circleId,
      name,
      createdBy: userId,
      createdAt,
      joinCode,
      isPartnerCircle,
    };
  }

  const circleRef = db.collection('circles').doc();
  await circleRef.set({
    name,
    createdBy: userId,
    createdAt,
    joinCode,
    isPartnerCircle,
  });
  await circleRef.collection('members').doc(userId).set({
    uid: userId,
    role: 'owner',
    displayName: owner.displayName || undefined,
    email: owner.email || undefined,
    joinedAt: createdAt,
  });
  if (options?.partner?.uid) {
    await circleRef.collection('members').doc(options.partner.uid).set({
      uid: options.partner.uid,
      role: 'member',
      displayName: options.partner.displayName || undefined,
      email: options.partner.email || undefined,
      joinedAt: createdAt,
    });
  }
  return {
    id: circleRef.id,
    name,
    createdBy: userId,
    createdAt,
    joinCode,
    isPartnerCircle,
  };
}

async function joinCircleData(code: string, user: { uid: string; displayName?: string | null; email?: string | null }): Promise<Record<string, any>> {
  if (isPostgresEnabled) {
    await ensurePostgresUserRow(user.uid);
    const circle = await getCircleByJoinCode(code);
    if (!circle) {
      throw new Error('circle_not_found');
    }
    await pgQuery(
      `
        insert into circle_members (circle_id, user_id, role, raw, created_at)
        values ($1, $2, 'member', $3::jsonb, now())
        on conflict (circle_id, user_id) do update
        set role = excluded.role,
            raw = excluded.raw
      `,
      [circle.id, user.uid, JSON.stringify({
        uid: user.uid,
        role: 'member',
        displayName: user.displayName || undefined,
        email: user.email || undefined,
        joinedAt: new Date().toISOString(),
      })],
    );
    return mapCircle(circle);
  }

  const snap = await db.collection('circles').where('joinCode', '==', code).get();
  if (snap.empty) {
    throw new Error('circle_not_found');
  }
  const circleDoc = snap.docs[0];
  const circleData = circleDoc.data() || {};
  await circleDoc.ref.collection('members').doc(user.uid).set({
    uid: user.uid,
    role: 'member',
    displayName: user.displayName || undefined,
    email: user.email || undefined,
    joinedAt: new Date().toISOString(),
  }, { merge: true });
  return {
    id: circleDoc.id,
    name: circleData.name,
    createdBy: circleData.createdBy,
    createdAt: circleData.createdAt,
    joinCode: circleData.joinCode,
    isPartnerCircle: circleData.isPartnerCircle || false,
  };
}

async function listCircleMembersData(circleId: string, userId: string): Promise<Record<string, any>[]> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleMemberRow>(
      `
        select *
        from circle_members
        where circle_id = $1
        order by created_at asc
      `,
      [circleId],
    );
    return result.rows.map(mapCircleMember);
  }

  const snap = await db.collection('circles').doc(circleId).collection('members').get();
  return snap.docs.map((docSnap) => docSnap.data() || {});
}

async function listCirclePlacesData(circleId: string, userId: string): Promise<Record<string, any>[]> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCirclePlaceRow>(
      `
        select *
        from circle_places
        where circle_id = $1
        order by created_at desc
      `,
      [circleId],
    );
    return result.rows.map(mapCirclePlace);
  }

  const snap = await db.collection('circles').doc(circleId).collection('places').get();
  return snap.docs.map((docSnap) => docSnap.data() || {});
}

async function saveCirclePlaceData(circleId: string, userId: string, place: Record<string, any>): Promise<void> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  const placeId = String(place.placeId || '').trim();
  if (!placeId) {
    throw new Error('place_id_required');
  }

  if (isPostgresEnabled) {
    await ensurePostgresPlace(placeId, String(place.placeSummary?.name || place.name || 'Circle place'));
    await pgQuery(
      `
        insert into circle_places (circle_id, place_id, added_by_user_id, raw, created_at)
        values ($1, $2, $3, $4::jsonb, now())
        on conflict (circle_id, place_id) do update
        set raw = excluded.raw,
            added_by_user_id = excluded.added_by_user_id
      `,
      [circleId, placeId, userId, JSON.stringify(stripUndefinedDeep(place) || {})],
    );
    return;
  }

  await db.collection('circles').doc(circleId).collection('places').doc(placeId).set(place, { merge: true });
}

async function removeCirclePlaceData(circleId: string, userId: string, placeId: string): Promise<void> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  if (isPostgresEnabled) {
    await pgQuery(
      `delete from circle_places where circle_id = $1 and place_id = $2`,
      [circleId, placeId],
    );
    return;
  }

  await db.collection('circles').doc(circleId).collection('places').doc(placeId).delete();
}

async function listCircleCommentsData(circleId: string, placeId: string, userId: string): Promise<Record<string, any>[]> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleCommentRow>(
      `
        select *
        from circle_place_comments
        where circle_id = $1 and place_id = $2
        order by created_at asc
      `,
      [circleId, placeId],
    );
    return result.rows.map(mapCircleComment);
  }

  const snap = await db.collection('circles').doc(circleId).collection('placeComments').where('placeId', '==', placeId).get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }) as Record<string, any>)
    .sort((a: Record<string, any>, b: Record<string, any>) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function addCircleCommentData(circleId: string, userId: string, placeId: string, comment: Record<string, any>): Promise<void> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  const payload = stripUndefinedDeep({ ...comment, placeId }) || {};
  if (isPostgresEnabled) {
    await pgQuery(
      `
        insert into circle_place_comments (id, circle_id, place_id, user_id, raw, created_at, updated_at)
        values ($1, $2, $3, $4, $5::jsonb, now(), now())
      `,
      [`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, circleId, placeId, userId, JSON.stringify(payload)],
    );
    return;
  }

  await db.collection('circles').doc(circleId).collection('placeComments').add(payload);
}

async function listCircleMemoriesData(circleId: string, userId: string): Promise<Record<string, any>[]> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleMemoryRow>(
      `
        select *
        from circle_memories
        where circle_id = $1
        order by created_at asc
      `,
      [circleId],
    );
    return result.rows.map(mapCircleMemory);
  }

  const snap = await db.collection('circles').doc(circleId).collection('memories').get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }) as Record<string, any>)
    .sort((a: Record<string, any>, b: Record<string, any>) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function addCircleMemoryData(circleId: string, userId: string, memory: Record<string, any>): Promise<void> {
  if (!(await isCircleMember(circleId, userId))) {
    throw new Error('circle_access_denied');
  }

  const memoryId = String(memory.memoryId || '').trim();
  if (!memoryId) {
    throw new Error('memory_id_required');
  }

  if (isPostgresEnabled) {
    await pgQuery(
      `
        insert into circle_memories (id, circle_id, user_id, raw, created_at, updated_at)
        values ($1, $2, $3, $4::jsonb, now(), now())
        on conflict (id) do update
        set raw = excluded.raw,
            updated_at = now()
      `,
      [memoryId, circleId, userId, JSON.stringify(stripUndefinedDeep(memory) || {})],
    );
    return;
  }

  await db.collection('circles').doc(circleId).collection('memories').doc(memoryId).set(memory, { merge: true });
}

async function deleteCircleData(circleId: string, userId: string): Promise<void> {
  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleRow>(
      `select * from circles where id = $1 limit 1`,
      [circleId],
    );
    const circle = result.rows[0];
    if (!circle) {
      throw new Error('circle_not_found');
    }
    if (circle.created_by !== userId) {
      throw new Error('circle_owner_required');
    }
    await pgQuery(`delete from circles where id = $1`, [circleId]);
    return;
  }

  const circleRef = db.collection('circles').doc(circleId);
  const circleSnap = await circleRef.get();
  if (!circleSnap.exists) {
    throw new Error('circle_not_found');
  }
  const circleData = circleSnap.data() || {};
  if (circleData.createdBy !== userId) {
    throw new Error('circle_owner_required');
  }
  for (const subcol of ['members', 'places', 'memories', 'placeComments']) {
    const subcolSnap = await circleRef.collection(subcol).get();
    await Promise.all(subcolSnap.docs.map((docSnap) => docSnap.ref.delete()));
  }
  await circleRef.delete();
}

async function leaveCircleData(circleId: string, userId: string): Promise<void> {
  if (isPostgresEnabled) {
    const result = await pgQuery<PostgresCircleRow>(
      `select * from circles where id = $1 limit 1`,
      [circleId],
    );
    const circle = result.rows[0];
    if (!circle) {
      throw new Error('circle_not_found');
    }
    if (circle.created_by === userId) {
      throw new Error('circle_owner_cannot_leave');
    }
    await pgQuery(
      `delete from circle_members where circle_id = $1 and user_id = $2`,
      [circleId, userId],
    );
    return;
  }

  const circleRef = db.collection('circles').doc(circleId);
  const circleSnap = await circleRef.get();
  if (!circleSnap.exists) {
    throw new Error('circle_not_found');
  }
  const circleData = circleSnap.data() || {};
  if (circleData.createdBy === userId) {
    throw new Error('circle_owner_cannot_leave');
  }
  await circleRef.collection('members').doc(userId).delete();
}

function mapPostgresPlaceClaim(row: PostgresPlaceClaimRow) {
  const raw = parsePgJson<Record<string, any>>(row.raw, {});
  return {
    id: row.id,
    placeId: row.place_id,
    placeName: row.place_name || raw.placeName || '',
    userId: row.user_id,
    userEmail: row.user_email || raw.userEmail || '',
    userDisplayName: row.user_display_name || raw.userDisplayName || '',
    status: row.status,
    businessRole: row.business_role,
    businessEmail: row.business_email,
    businessPhone: row.business_phone,
    verificationMethod: row.verification_method || 'manual',
    verificationEvidence: parsePgJson(row.verification_evidence, {}),
    rejectionReason: row.rejection_reason || undefined,
    reviewedBy: row.reviewed_by || undefined,
    createdAt: toIsoString(row.created_at),
    reviewedAt: toIsoString(row.reviewed_at),
  };
}

async function getPostgresPlaceClaimById(claimId: string): Promise<PostgresPlaceClaimRow | null> {
  const result = await pgQuery<PostgresPlaceClaimRow>(
    `
      select
        pc.*,
        p.name as place_name,
        u.email as user_email,
        u.display_name as user_display_name
      from place_claims pc
      left join places p on p.id = pc.place_id
      left join users u on u.id = pc.user_id
      where pc.id = $1
      limit 1
    `,
    [claimId],
  );
  return result.rows[0] || null;
}

async function isAdminUserViaFirestore(userId: string): Promise<boolean> {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  return userData?.isAdmin === true || isAdminAccessUser(userData as Record<string, any> | undefined);
}
// Middleware to verify Firebase Auth token
async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    req.uid = decodedToken.uid;
    next();
  } catch (err: any) {
    console.error('[FamPal API] Auth verification failed:', err?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireSchedulerAuth(req: Request, res: Response, next: NextFunction) {
  const tokenFromHeader = (req.headers['x-scheduler-token'] as string) || '';
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const provided = tokenFromHeader || bearer;
  const isProd = process.env.NODE_ENV === 'production';

  if (!PLACE_REFRESH_CRON_TOKEN) {
    if (isProd) {
      return res.status(500).json({ error: 'PLACE_REFRESH_CRON_TOKEN is required in production' });
    }
    console.warn('[FamPal Refresh] PLACE_REFRESH_CRON_TOKEN missing; allowing local/dev execution.');
    next();
    return;
  }

  if (provided !== PLACE_REFRESH_CRON_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized scheduler request' });
  }
  next();
}

type PlaySubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'pending'
  | 'grace_period'
  | 'cancelled_active'
  | 'billing_retry'
  | 'expired';

function hashPurchaseToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isPlayStatusPaid(status: PlaySubscriptionStatus): boolean {
  return status === 'active' || status === 'grace_period' || status === 'cancelled_active';
}

function mapPlanStatusFromPlay(status: PlaySubscriptionStatus): 'active' | 'cancelled' | 'expired' {
  if (status === 'cancelled_active') return 'cancelled';
  if (status === 'active' || status === 'grace_period') return 'active';
  return 'expired';
}

function mapClientFallbackPlayStatus(purchaseState: number | null, autoRenewing: boolean | null): PlaySubscriptionStatus {
  if (purchaseState === 2) return 'pending';
  if (purchaseState === 1) return autoRenewing === false ? 'cancelled_active' : 'active';
  return 'inactive';
}

function mapPlayApiStateToStatus(subscriptionState: string | undefined, expiryTime: string | null, autoRenewEnabled: boolean): PlaySubscriptionStatus {
  const now = Date.now();
  const expiryMs = expiryTime ? Date.parse(expiryTime) : NaN;
  const hasFutureExpiry = Number.isFinite(expiryMs) && expiryMs > now;

  switch (subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return autoRenewEnabled ? 'active' : 'cancelled_active';
    case 'SUBSCRIPTION_STATE_PENDING':
      return 'pending';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'grace_period';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'billing_retry';
    case 'SUBSCRIPTION_STATE_CANCELED':
      return hasFutureExpiry ? 'cancelled_active' : 'expired';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
    default:
      return hasFutureExpiry ? 'cancelled_active' : 'inactive';
  }
}

async function verifyPlaySubscriptionOnServer(
  purchaseToken: string,
): Promise<{
  status: PlaySubscriptionStatus;
  productId: string | null;
  expiryTime: string | null;
  autoRenewing: boolean;
  rawState: string | null;
  latestOrderId: string | null;
}> {
  const credentials = JSON.parse(GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken) {
    throw new Error('google_play_access_token_unavailable');
  }

  const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(verifyUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 404) {
    return {
      status: 'inactive',
      productId: null,
      expiryTime: null,
      autoRenewing: false,
      rawState: 'NOT_FOUND',
      latestOrderId: null,
    };
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`google_play_verify_failed_${response.status}:${bodyText}`);
  }

  const payload: any = await response.json();
  const lineItem = Array.isArray(payload?.lineItems) ? payload.lineItems[0] : null;
  const productId = lineItem?.productId || null;
  const expiryTime = lineItem?.expiryTime || null;
  const latestOrderId = lineItem?.latestSuccessfulOrderId || null;
  const autoRenewing = lineItem?.autoRenewingPlan?.autoRenewEnabled === true;
  const rawState = payload?.subscriptionState || null;
  const status = mapPlayApiStateToStatus(rawState || undefined, expiryTime, autoRenewing);

  return { status, productId, expiryTime, autoRenewing, rawState, latestOrderId };
}

type PlaceRefreshOptions = {
  limit?: number;
  dryRun?: boolean;
};

async function fetchGooglePlaceForRefresh(googlePlaceId: string): Promise<any> {
  const response = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,types,priceLevel,location,photos,primaryType,primaryTypeDisplayName,googleMapsUri,goodForChildren,menuForChildren,restroom,allowsDogs,accessibilityOptions,parkingOptions',
    },
  });
  if (!response.ok) {
    throw new Error(`Google details refresh failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function runPlaceRefreshJob(options: PlaceRefreshOptions = {}) {
  const startedAt = Date.now();
  if (!PLACES_CONFIGURED) {
    return {
      ok: false,
      reason: 'GOOGLE_PLACES_API_KEY missing',
      scannedCount: 0,
      staleCount: 0,
      refreshedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      limitPerRun: 0,
      elapsedMs: 0,
    };
  }

  const limitPerRun = Math.max(1, Math.min(Number(options.limit || PLACE_REFRESH_MAX_PER_RUN), 200));
  const candidateLimit = Math.max(limitPerRun * PLACE_REFRESH_CANDIDATE_MULTIPLIER, limitPerRun);
  const dryRun = options.dryRun === true;
  const now = new Date();
  const staleCandidates: Array<{ id: string; data: any }> = [];

  const snap = await db.collection('places').orderBy('lastRefreshedAt', 'asc').limit(candidateLimit).get();
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const lastRefreshedAt = data.lastRefreshedAt?.toDate?.() || null;
    const savedCount = Math.max(0, Number(data.savedCount || 0));
    const viewCount = Math.max(0, Number(data.viewCount || 0));
    const popularityScore = Math.max(
      0,
      Number(data.popularityScore || computePopularityScore(savedCount, viewCount, Number(data.userRatingsTotal || 0)))
    );
    const staleAfterDays = computeStaleAfterDays(savedCount, viewCount, popularityScore);
    const staleMillis = staleAfterDays * 24 * 60 * 60 * 1000;
    const staleByLastRefreshed = !lastRefreshedAt || now.getTime() - lastRefreshedAt.getTime() >= staleMillis;
    const nextRefreshAtRaw = data.refreshState?.nextRefreshAt;
    const nextRefreshAt = nextRefreshAtRaw?.toDate?.() || (typeof nextRefreshAtRaw === 'string' ? new Date(nextRefreshAtRaw) : null);
    const staleByNextRefresh = nextRefreshAt instanceof Date && !Number.isNaN(nextRefreshAt.getTime())
      ? nextRefreshAt.getTime() <= now.getTime()
      : false;
    if (staleByLastRefreshed || staleByNextRefresh) {
      staleCandidates.push({ id: docSnap.id, data });
    }
  });

  const staleTargets = staleCandidates
    .filter((item) => typeof item.data.googlePlaceId === 'string' && item.data.googlePlaceId.length > 0)
    .slice(0, limitPerRun);

  let refreshedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ placeId: string; error: string }> = [];

  const queue = [...staleTargets];
  const workers = Array.from({ length: PLACE_REFRESH_CONCURRENCY }).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      const placeRef = db.collection('places').doc(next.id);
      const googlePlaceId = String(next.data.googlePlaceId || '');
      if (!googlePlaceId) {
        skippedCount += 1;
        continue;
      }
      const previousFailures = Number(next.data?.refreshState?.consecutiveFailures || 0);
      const requestedCategory = next.data?.categoryContext?.requestedCategory || 'all';
      const savedCount = Math.max(0, Number(next.data.savedCount || 0));
      const viewCount = Math.max(0, Number(next.data.viewCount || 0));

      if (dryRun) {
        refreshedCount += 1;
        continue;
      }

      try {
        await placeRef.set({
          refreshState: {
            ...(next.data.refreshState || {}),
            status: 'refreshing',
            lastAttemptAt: FieldValue.serverTimestamp(),
          },
        }, { merge: true });

        const p = await fetchGooglePlaceForRefresh(googlePlaceId);
        const imageUrl = p.photos?.[0]
          ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`
          : null;
        const source = {
          googlePlaceId: p.id || googlePlaceId,
          name: p.displayName?.text || next.data.name || 'Unknown Place',
          address: p.formattedAddress || next.data.address || '',
          lat: p.location?.latitude || next.data?.geo?.lat || 0,
          lng: p.location?.longitude || next.data?.geo?.lng || 0,
          types: Array.isArray(p.types) ? p.types : [],
          primaryType: p.primaryType || null,
          primaryTypeDisplayName: p.primaryTypeDisplayName?.text || null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          userRatingsTotal: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
          priceLevel: p.priceLevel || null,
          mapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${googlePlaceId}`,
          photoUrl: imageUrl,
          goodForChildren: p.goodForChildren === true,
          menuForChildren: p.menuForChildren === true,
          restroom: p.restroom === true,
          allowsDogs: p.allowsDogs === true,
          accessibilityOptions: p.accessibilityOptions || {},
          parkingOptions: p.parkingOptions || {},
        };
        const facets = buildFacetSnapshotFromGoogle({
          name: source.name,
          address: source.address,
          types: source.types,
          primaryTypeDisplayName: source.primaryTypeDisplayName || undefined,
          goodForChildren: source.goodForChildren,
          menuForChildren: source.menuForChildren,
          restroom: source.restroom,
          allowsDogs: source.allowsDogs,
          accessibilityOptions: source.accessibilityOptions,
          requestedCategory,
          rating: source.rating || undefined,
          userRatingsTotal: source.userRatingsTotal || undefined,
        });
        const popularityScore = computePopularityScore(savedCount, viewCount, source.userRatingsTotal || undefined);
        const staleAfterDays = computeStaleAfterDays(savedCount, viewCount, popularityScore);
        const nextRefreshAt = new Date(Date.now() + staleAfterDays * 24 * 60 * 60 * 1000);
        const versionHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({
            id: source.googlePlaceId,
            rating: source.rating,
            userRatingsTotal: source.userRatingsTotal,
            priceLevel: source.priceLevel,
            types: source.types,
            lat: source.lat,
            lng: source.lng,
          }))
          .digest('hex')
          .slice(0, 12);

        await placeRef.set({
          placeId: next.id,
          googlePlaceId: source.googlePlaceId,
          name: source.name,
          normalizedName: source.name.toLowerCase().trim(),
          address: source.address,
          geo: { lat: source.lat, lng: source.lng },
          rating: source.rating,
          userRatingsTotal: source.userRatingsTotal,
          priceLevel: source.priceLevel,
          mapsUrl: source.mapsUrl,
          imageUrl: source.photoUrl,
          types: source.types,
          primaryType: source.primaryType,
          facets: {
            categories: facets.categories,
            venueTypes: facets.venueTypes,
            foodTypes: facets.foodTypes,
            kidFriendlySignals: facets.kidFriendlySignals,
            accessibilitySignals: facets.accessibilitySignals,
            indoorOutdoorSignals: facets.indoorOutdoorSignals,
          },
          facetsConfidence: facets.confidence,
          sourceVersions: { google: versionHash },
          popularityScore,
          staleAfterDays,
          savedCount,
          viewCount,
          refreshState: {
            status: 'ready',
            consecutiveFailures: 0,
            lastAttemptAt: FieldValue.serverTimestamp(),
            lastError: null,
            nextRefreshAt,
          },
          lastRefreshedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await placeRef.collection('sources').doc('google').set({
          googlePlaceId: source.googlePlaceId,
          versionHash,
          fetchedAt: FieldValue.serverTimestamp(),
          requestedCategory,
          searchQuery: null,
          ingestionSource: 'scheduler_refresh',
          source: p,
        }, { merge: true });

        refreshedCount += 1;
      } catch (err: any) {
        failedCount += 1;
        const failureCount = previousFailures + 1;
        const backoffDays = Math.min(30, Math.max(1, 2 ** Math.min(failureCount, 5)));
        const nextRetry = new Date(Date.now() + backoffDays * 24 * 60 * 60 * 1000);
        errors.push({ placeId: next.id, error: err?.message || 'refresh_failed' });
        await placeRef.set({
          refreshState: {
            status: 'error',
            consecutiveFailures: failureCount,
            lastAttemptAt: FieldValue.serverTimestamp(),
            lastError: err?.message || 'refresh_failed',
            nextRefreshAt: nextRetry,
          },
        }, { merge: true });
      }
    }
  });

  await Promise.all(workers);
  const elapsedMs = Date.now() - startedAt;
  console.log('[FamPal Refresh] completed', {
    dryRun,
    scannedCount: snap.size,
    staleCount: staleTargets.length,
    refreshedCount,
    failedCount,
    skippedCount,
    limitPerRun,
    elapsedMs,
  });

  return {
    ok: true,
    dryRun,
    scannedCount: snap.size,
    staleCount: staleTargets.length,
    refreshedCount,
    failedCount,
    skippedCount,
    limitPerRun,
    elapsedMs,
    errors: errors.slice(0, 20),
  };
}

if (!PLACES_CONFIGURED) {
  console.warn('[FamPal API] Google Places API key is not configured. Places search will fail.');
}

const LEGACY_PLACE_TYPE_MAP: Record<string, string | undefined> = {
  restaurant: 'restaurant',
  outdoor: 'park',
  indoor: 'museum',
  active: 'playground',
  hike: 'park',
  wine: 'bar',
  golf: 'golf_course',
  all: undefined,
};

function resolveLegacyType(type?: string | string[]) {
  if (!type) return undefined;
  const key = Array.isArray(type) ? type[0] : type;
  return LEGACY_PLACE_TYPE_MAP[key] || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_').trim();
}

function normalizeFacetToken(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, '_');
}

function computePopularityScore(savedCount: number, viewCount: number, userRatingsTotal?: number): number {
  const ratingsSignal = Math.min(Math.max(userRatingsTotal || 0, 0), 1000);
  return Math.max(0, savedCount * 20 + viewCount + Math.round(ratingsSignal / 10));
}

function computeStaleAfterDays(savedCount: number, viewCount: number, popularityScore: number): number {
  const highEngagement = savedCount >= 10 || viewCount >= 500 || popularityScore >= 120;
  return highEngagement ? 7 : 30;
}

function buildFacetSnapshotFromGoogle(source: {
  name: string;
  address: string;
  types: string[];
  primaryTypeDisplayName?: string;
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  restroom?: boolean;
  allowsDogs?: boolean;
  accessibilityOptions?: Record<string, unknown>;
  requestedCategory?: string;
  rating?: number;
  userRatingsTotal?: number;
}): {
  categories: string[];
  venueTypes: string[];
  foodTypes: string[];
  kidFriendlySignals: string[];
  accessibilitySignals: string[];
  petFriendlySignals: string[];
  indoorOutdoorSignals: string[];
  confidence: number;
} {
  const types = (source.types || []).map(normalizeFacetToken);
  const text = `${source.name || ''} ${source.primaryTypeDisplayName || ''} ${source.address || ''}`.toLowerCase();
  const venueTypes = new Set<string>();
  const foodTypes = new Set<string>();
  const kidFriendlySignals = new Set<string>();
  const accessibilitySignals = new Set<string>();
  const indoorOutdoorSignals = new Set<string>();
  const indoorHints = ['museum', 'gallery', 'library', 'cinema', 'mall', 'bowling', 'aquarium', 'indoor'];
  const outdoorHints = ['park', 'trail', 'hike', 'beach', 'garden', 'camp', 'nature', 'outdoor'];

  if (types.includes('restaurant') || types.includes('meal_takeaway') || types.includes('meal_delivery')) venueTypes.add('restaurant');
  if (types.includes('cafe') || types.includes('coffee_shop')) venueTypes.add('cafe');
  if (types.includes('bar') || types.includes('pub')) venueTypes.add('bar_pub');
  if (types.includes('market')) venueTypes.add('market');
  if (types.includes('bakery')) venueTypes.add('bakery');
  if (types.includes('food_truck') || text.includes('food truck')) venueTypes.add('food_truck');
  if (types.includes('winery') || text.includes('wine farm') || text.includes('wine estate') || text.includes('wine tasting')) venueTypes.add('wine_farm');

  ['coffee', 'bakery', 'brunch', 'breakfast', 'pizza', 'sushi', 'burger', 'steak', 'seafood', 'italian', 'pasta', 'indian', 'curry', 'mexican', 'tacos', 'asian', 'thai', 'chinese', 'ice cream', 'gelato', 'farm stall']
    .forEach((keyword) => {
      if (text.includes(keyword)) foodTypes.add(normalizeFacetToken(keyword));
    });

  if (source.goodForChildren) kidFriendlySignals.add('child_friendly_space');
  if (source.menuForChildren) kidFriendlySignals.add('kids_menu');
  if (text.includes('high chair')) kidFriendlySignals.add('high_chair');
  if (text.includes('play area') || text.includes('playground') || text.includes('jungle gym')) kidFriendlySignals.add('play_area_jungle_gym');
  if (text.includes('stroller') || text.includes('pram')) kidFriendlySignals.add('stroller_friendly');

  const accessibilityText = JSON.stringify(source.accessibilityOptions || {}).toLowerCase();
  if (source.restroom || accessibilityText.includes('wheelchair') || accessibilityText.includes('accessible')) {
    accessibilitySignals.add('wheelchair_friendly');
  }
  if (source.restroom || accessibilityText.includes('restroom') || accessibilityText.includes('toilet')) {
    accessibilitySignals.add('accessible_toilet');
  }
  if (text.includes('quiet') || text.includes('calm')) accessibilitySignals.add('quiet_friendly');

  const petFriendlySignals = new Set<string>();
  if (source.allowsDogs) petFriendlySignals.add('dogs_allowed');
  if (text.includes('pet friendly') || text.includes('dog friendly') || text.includes('pets welcome') || text.includes('dogs welcome')) petFriendlySignals.add('dogs_allowed');
  if (text.includes('off-leash') || text.includes('off leash') || text.includes('dog park')) petFriendlySignals.add('off_leash_area');
  if (text.includes('pet patio') || text.includes('dog patio') || text.includes('outdoor seating')) petFriendlySignals.add('pet_friendly_patio');
  if (text.includes('water bowl') || text.includes('water bowls') || text.includes('dog water')) petFriendlySignals.add('water_bowls');
  if (text.includes('enclosed garden') || text.includes('fenced garden') || text.includes('fenced yard') || text.includes('enclosed yard')) petFriendlySignals.add('enclosed_garden');
  if (text.includes('pets inside') || text.includes('dogs inside') || text.includes('pets indoors') || text.includes('dogs indoors') || text.includes('pets allowed inside')) petFriendlySignals.add('pets_inside_allowed');
  if (types.includes('dog_park') || types.includes('pet_store')) {
    petFriendlySignals.add('dogs_allowed');
    petFriendlySignals.add('off_leash_area');
  }

  const hasIndoor = types.some((t) => indoorHints.includes(t)) || indoorHints.some((k) => text.includes(k));
  const hasOutdoor = types.some((t) => outdoorHints.includes(t)) || outdoorHints.some((k) => text.includes(k));
  if (hasIndoor) indoorOutdoorSignals.add('indoor');
  if (hasOutdoor) indoorOutdoorSignals.add('outdoor');
  if (hasIndoor && hasOutdoor) indoorOutdoorSignals.add('both');

  const categories = new Set<string>();
  if (types.some((type) => ['restaurant', 'cafe', 'meal_takeaway', 'meal_delivery', 'bakery'].includes(type))) categories.add('restaurant');
  if (types.some((type) => ['park', 'national_park', 'beach', 'campground', 'hiking_area'].includes(type))) categories.add('outdoor');
  if (types.some((type) => ['museum', 'movie_theater', 'library', 'bowling_alley', 'aquarium'].includes(type))) categories.add('indoor');
  if (types.some((type) => ['gym', 'sports_complex', 'swimming_pool', 'amusement_park', 'playground'].includes(type))) categories.add('active');
  if (types.some((type) => ['hiking_area', 'national_park', 'state_park'].includes(type)) || text.includes('hike') || text.includes('trail')) categories.add('hike');
  if (types.some((type) => ['winery', 'vineyard'].includes(type)) || text.includes('wine farm') || text.includes('wine estate') || text.includes('wine tasting')) categories.add('wine');
  if (types.some((type) => ['golf_course'].includes(type)) || text.includes('golf')) categories.add('golf');
  if (types.some((type) => ['playground', 'amusement_park', 'zoo', 'aquarium'].includes(type)) || text.includes('kids') || text.includes('family') || text.includes('child')) categories.add('kids');
  if (categories.size === 0 && source.requestedCategory && source.requestedCategory !== 'all') categories.add(source.requestedCategory);
  if (categories.size === 0) categories.add('all');

  const signalCount =
    (venueTypes.size > 0 ? 1 : 0) +
    (foodTypes.size > 0 ? 1 : 0) +
    (kidFriendlySignals.size > 0 ? 1 : 0) +
    (accessibilitySignals.size > 0 ? 1 : 0) +
    (petFriendlySignals.size > 0 ? 1 : 0) +
    (indoorOutdoorSignals.size > 0 ? 1 : 0);
  const confidence = Math.min(
    0.95,
    0.35 + signalCount * 0.1 + (typeof source.rating === 'number' ? 0.08 : 0) + ((source.userRatingsTotal || 0) >= 20 ? 0.12 : 0)
  );

  return {
    categories: Array.from(categories),
    venueTypes: Array.from(venueTypes),
    foodTypes: Array.from(foodTypes),
    kidFriendlySignals: Array.from(kidFriendlySignals),
    accessibilitySignals: Array.from(accessibilitySignals),
    petFriendlySignals: Array.from(petFriendlySignals),
    indoorOutdoorSignals: Array.from(indoorOutdoorSignals),
    confidence: Number(confidence.toFixed(2)),
  };
}

function includesAny(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

interface PlanConfig {
  name: string;
  amount: number;
  currency: string;
  interval: string | null;
  plan_code?: string;
}

const PLANS: Record<string, PlanConfig> = {
  pro: {
    name: 'Pro Plan',
    amount: 5900,
    currency: 'ZAR',
    interval: 'monthly',
    plan_code: process.env.PAYSTACK_PRO_PLAN_CODE || '',
  },
  business_pro: {
    name: 'Business Pro',
    amount: 14900,
    currency: 'ZAR',
    interval: 'monthly',
    plan_code: process.env.PAYSTACK_BUSINESS_PRO_PLAN_CODE || '',
  },
};

function verifyPaystackSignature(rawBody: Buffer, signature: string): boolean {
  if (!PAYSTACK_SECRET_KEY) return false;
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    placesConfigured: PLACES_CONFIGURED,
    postgresEnabled: isPostgresEnabled,
    postgresReady: isPostgresEnabled ? await pgHealthCheck() : false,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

app.post('/api/admin/places/refresh-stale', requireSchedulerAuth, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const limit = Number(req.query.limit || req.body?.limit || PLACE_REFRESH_MAX_PER_RUN);
    const result = await runPlaceRefreshJob({ dryRun, limit });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error: any) {
    console.error('[FamPal Refresh] endpoint error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'place_refresh_failed' });
  }
});

const placesSearchRateLimit = createIpRateLimiter({ windowMs: 60_000, max: 120, label: 'places_search' });
const placesDetailsRateLimit = createIpRateLimiter({ windowMs: 60_000, max: 90, label: 'places_details' });
const placesPhotoRateLimit = createIpRateLimiter({ windowMs: 60_000, max: 180, label: 'places_photo' });

app.get('/api/places/nearby', placesSearchRateLimit, createJsonCache(PLACES_SEARCH_CACHE_TTL_MS, 'places_nearby'), async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Missing or invalid lat/lng' });
    }
    const radiusKm = Number(req.query.radiusKm || 10);
    const radiusMeters = Math.min(Math.max(radiusKm, 0.1) * 1000, 50000);
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
    const typeParam = typeof req.query.type === 'string' ? req.query.type : undefined;
    const legacyType = resolveLegacyType(typeParam);

    const params = new URLSearchParams({
      key: GOOGLE_PLACES_API_KEY,
      location: `${lat},${lng}`,
      radius: `${radiusMeters}`,
    });
    if (legacyType) {
      params.set('type', legacyType);
    }
    if (pageToken) {
      params.set('pagetoken', pageToken);
    }

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.status === 'INVALID_REQUEST' && pageToken) {
      return res.status(409).json({ error: 'page_token_not_ready' });
    }
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(400).json({ error: data.error_message || data.status, status: data.status });
    }
    return res.json({
      results: data.results || [],
      nextPageToken: data.next_page_token || null,
      hasMore: !!data.next_page_token,
    });
  } catch (error) {
    console.error('Places nearby error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Places search failed' });
  }
});

app.get('/api/places/text', placesSearchRateLimit, createJsonCache(PLACES_SEARCH_CACHE_TTL_MS, 'places_text'), async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Missing or invalid lat/lng' });
    }
    const radiusKm = Number(req.query.radiusKm || 10);
    const radiusMeters = Math.min(Math.max(radiusKm, 0.1) * 1000, 50000);
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;

    const params = new URLSearchParams({
      key: GOOGLE_PLACES_API_KEY,
      query: `${query} family friendly`,
      location: `${lat},${lng}`,
      radius: `${radiusMeters}`,
    });
    if (pageToken) {
      params.set('pagetoken', pageToken);
    }

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.status === 'INVALID_REQUEST' && pageToken) {
      return res.status(409).json({ error: 'page_token_not_ready' });
    }
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(400).json({ error: data.error_message || data.status, status: data.status });
    }
    return res.json({
      results: data.results || [],
      nextPageToken: data.next_page_token || null,
      hasMore: !!data.next_page_token,
    });
  } catch (error) {
    console.error('Places text search error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Places search failed' });
  }
});

app.get('/api/places/search', placesSearchRateLimit, createJsonCache(PLACES_SEARCH_CACHE_TTL_MS, 'places_search'), async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const query = typeof req.query.q === 'string'
      ? req.query.q.trim()
      : (typeof req.query.query === 'string' ? req.query.query.trim() : '');
    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Missing or invalid lat/lng' });
    }
    const radiusKm = Number(req.query.radiusKm || 10);
    const radiusMeters = Math.min(Math.max(radiusKm, 0.1) * 1000, 50000);
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;

    const params = new URLSearchParams({
      key: GOOGLE_PLACES_API_KEY,
      query: `${query} family friendly`,
      location: `${lat},${lng}`,
      radius: `${radiusMeters}`,
    });
    if (pageToken) params.set('pagetoken', pageToken);

    const response = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`);
    const data = await response.json();
    if (data.status === 'INVALID_REQUEST' && pageToken) {
      return res.status(409).json({ error: 'page_token_not_ready' });
    }
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(400).json({ error: data.error_message || data.status, status: data.status });
    }
    return res.json({
      results: data.results || [],
      nextPageToken: data.next_page_token || null,
      hasMore: !!data.next_page_token,
    });
  } catch (error) {
    console.error('Places search error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Places search failed' });
  }
});

app.get('/api/places/intent', placesSearchRateLimit, createJsonCache(PLACES_SEARCH_CACHE_TTL_MS, 'places_intent'), async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const intent = (typeof req.query.intent === 'string' ? req.query.intent : 'all') as ExploreIntentId;
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Missing or invalid lat/lng' });
    }
    const radiusKm = Number(req.query.radiusKm || 10);
    const radiusMeters = Math.min(Math.max(radiusKm, 0.1) * 1000, 50000);
    const searchQuery = typeof req.query.searchQuery === 'string' ? req.query.searchQuery.trim() : '';
    const definition = getExploreIntentDefinition(intent);
    const queries = Array.from(
      new Set((searchQuery ? [searchQuery, ...definition.queries.slice(0, 2)] : definition.queries).map((q) => q.toLowerCase().trim()))
    );

    const dedupeMap = new Map<string, any>();
    const perQueryCounts: Record<string, { pagesFetched: number; fetchedResults: number; uniqueAdded: number }> = {};

    console.log(`[FamPal API] Explore intent selected: ${intent}`);
    console.log(`[FamPal API] Intent queries executed: ${queries.join(', ')}`);

    for (const query of queries) {
      let nextPageToken: string | undefined = undefined;
      let hasMore = true;
      let page = 1;
      let fetchedResults = 0;
      const beforeUnique = dedupeMap.size;

      while (page <= 3 && hasMore) {
        if (page > 1) {
          await sleep(2000);
        }

        const params = new URLSearchParams({
          key: GOOGLE_PLACES_API_KEY,
          query: query,
          location: `${lat},${lng}`,
          radius: `${radiusMeters}`,
        });
        if (nextPageToken) {
          params.set('pagetoken', nextPageToken);
        }

        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
        const response = await fetchWithTimeout(url);
        const data = await response.json();

        if (data.status === 'INVALID_REQUEST' && nextPageToken) {
          await sleep(2000);
          continue;
        }
        if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.warn('[FamPal API] Intent text search warning:', data.status, data.error_message || '');
          break;
        }

        const results = Array.isArray(data.results) ? data.results : [];
        fetchedResults += results.length;
        for (const result of results) {
          const placeId = result?.place_id || result?.id;
          if (!placeId) continue;
          dedupeMap.set(placeId, result);
        }

        const mergedResults = Array.from(dedupeMap.values());
        const filtered = mergedResults.filter((place) => {
          const types = (Array.isArray(place?.types) ? place.types : []).map((t: string) => normalizeType(t));
          const typeSet = new Set(types);
          const text = `${place?.name || ''} ${place?.formatted_address || ''}`.toLowerCase();
          const includeTypes = definition.includeTypes.map(normalizeType);
          const excludeTypes = definition.excludeTypes.map(normalizeType);

          if (includesAny(text, definition.keywordExclude)) return false;
          if (excludeTypes.some((type) => typeSet.has(type))) return false;
          if (includeTypes.length === 0) return true;
          if (includeTypes.some((type) => typeSet.has(type))) return true;
          return includesAny(text, definition.keywordInclude);
        });

        perQueryCounts[query] = {
          pagesFetched: page,
          fetchedResults,
          uniqueAdded: dedupeMap.size - beforeUnique,
        };

        console.log(`[FamPal API] Query "${query}" page ${page}: ${results.length} results, hasMore: ${!!data.next_page_token}`);
        console.log(`[FamPal API] Merge count after "${query}" page ${page}: ${mergedResults.length} before filter, ${filtered.length} after filter`);

        nextPageToken = data.next_page_token || undefined;
        hasMore = !!nextPageToken;
        page += 1;
      }
    }

    const mergedResults = Array.from(dedupeMap.values());
    const filteredResults = mergedResults.filter((place) => {
      const types = (Array.isArray(place?.types) ? place.types : []).map((t: string) => normalizeType(t));
      const typeSet = new Set(types);
      const text = `${place?.name || ''} ${place?.formatted_address || ''}`.toLowerCase();
      const includeTypes = definition.includeTypes.map(normalizeType);
      const excludeTypes = definition.excludeTypes.map(normalizeType);

      if (includesAny(text, definition.keywordExclude)) return false;
      if (excludeTypes.some((type) => typeSet.has(type))) return false;
      if (includeTypes.length === 0) return true;
      if (includeTypes.some((type) => typeSet.has(type))) return true;
      return includesAny(text, definition.keywordInclude);
    });

    console.log(`[FamPal API] Intent "${intent}" filter counts: before=${mergedResults.length}, after=${filteredResults.length}`);

    return res.json({
      places: filteredResults,
      results: filteredResults,
      hasMore: false,
      nextPageToken: null,
      debug: {
        intent,
        subtitle: definition.subtitle,
        queriesRun: queries,
        perQueryCounts,
        totalBeforeFilter: mergedResults.length,
        totalAfterFilter: filteredResults.length,
      },
    });
  } catch (error) {
    console.error('Places intent search error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Places intent search failed' });
  }
});

app.get('/api/subscription/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.json({ entitlement: null });
    }
    
    const data = userDoc.data();
    return res.json({ entitlement: data?.entitlement || null });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.get('/api/places/details/:placeId', placesDetailsRateLimit, createJsonCache(PLACES_DETAILS_CACHE_TTL_MS, 'places_details'), async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const placeId = String(req.params.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ error: 'Missing placeId' });
    }

    const baseFields = 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,regularOpeningHours,photos,reviews,priceLevel,types,location,googleMapsUri,accessibilityOptions,goodForChildren,menuForChildren,restroom,allowsDogs,parkingOptions';
    const extendedFields = `${baseFields},editorialSummary,generativeSummary`;

    let response = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': extendedFields,
      },
    });
    if (!response.ok && response.status === 400) {
      response = await fetchWithTimeout(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': baseFields,
        },
      });
    }

    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).json({ error: 'Places details failed' });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('Places details error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Places details failed' });
  }
});

app.get('/api/places/photo', placesPhotoRateLimit, async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Places API not configured' });
    }
    const photoName = typeof req.query.photoName === 'string' ? req.query.photoName.trim() : '';
    const photoReference = typeof req.query.photoReference === 'string' ? req.query.photoReference.trim() : '';
    const maxWidth = Number(req.query.maxWidth || 600);
    const maxHeight = Number(req.query.maxHeight || 400);

    let targetUrl = '';
    if (photoName) {
      targetUrl = `https://places.googleapis.com/v1/${encodeURIComponent(photoName)}/media?maxHeightPx=${Math.min(Math.max(maxHeight, 64), 1600)}&maxWidthPx=${Math.min(Math.max(maxWidth, 64), 1600)}&key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}`;
    } else if (photoReference) {
      targetUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${Math.min(Math.max(maxWidth, 64), 1600)}&photo_reference=${encodeURIComponent(photoReference)}&key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}`;
    } else {
      return res.status(400).json({ error: 'Missing photoName or photoReference' });
    }

    const response = await fetchWithTimeout(targetUrl);
    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).json({ error: 'Photo fetch failed' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const cacheControl = response.headers.get('cache-control') || 'public, max-age=300, stale-while-revalidate=86400';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    const stream = response.body;
    if (!stream) {
      return res.status(502).json({ error: 'Photo stream unavailable' });
    }
    Readable.fromWeb(stream as any).pipe(res);
    return;
  } catch (error) {
    console.error('Places photo proxy error:', (error as any)?.name || 'unknown_error');
    return res.status(500).json({ error: 'Photo proxy failed' });
  }
});

app.post('/api/play/subscription/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const requestedProductId = typeof req.body?.productId === 'string' ? req.body.productId.trim() : '';
    const purchaseToken = typeof req.body?.purchaseToken === 'string' ? req.body.purchaseToken.trim() : '';
    const purchaseState = Number.isFinite(Number(req.body?.purchaseState)) ? Number(req.body.purchaseState) : null;
    const autoRenewing = typeof req.body?.autoRenewing === 'boolean' ? req.body.autoRenewing : null;
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : null;

    const productId = requestedProductId || GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS[0];
    if (!productId || !GOOGLE_PLAY_SUBSCRIPTION_PRODUCT_IDS.includes(productId)) {
      return res.status(400).json({ error: 'Unsupported subscription product id' });
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? (userDoc.data() as Record<string, any>) : {};
    if (isAdminAccessUser(userData)) {
      return res.json({
        status: 'active',
        source: 'admin',
        entitlement: userData?.entitlement || null,
        skipped: true,
      });
    }

    let status: PlaySubscriptionStatus = 'inactive';
    let verifiedProductId: string | null = productId;
    let expiryTime: string | null = null;
    let autoRenewFlag = autoRenewing === true;
    let playState: string | null = null;
    let latestOrderId: string | null = orderId;

    if (purchaseToken) {
      if (GOOGLE_PLAY_VERIFICATION_ENABLED) {
        const verification = await verifyPlaySubscriptionOnServer(purchaseToken);
        status = verification.status;
        verifiedProductId = verification.productId || productId;
        expiryTime = verification.expiryTime;
        autoRenewFlag = verification.autoRenewing;
        playState = verification.rawState;
        latestOrderId = verification.latestOrderId || latestOrderId;
      } else {
        status = mapClientFallbackPlayStatus(purchaseState, autoRenewing);
      }
    }

    const existingEntitlement = (userData?.entitlement || {}) as Record<string, any>;
    const nowIso = new Date().toISOString();
    const nextResetDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();
    const tier = isPlayStatusPaid(status) ? 'pro' : 'free';
    const planStatus = mapPlanStatusFromPlay(status);

    const mergedEntitlement = {
      ...existingEntitlement,
      subscription_tier: tier,
      subscription_status: status,
      subscription_source: purchaseToken || existingEntitlement.subscription_source === 'play' ? 'play' : null,
      plan_tier: tier,
      plan_status: planStatus,
      entitlement_source: purchaseToken || existingEntitlement.entitlement_source === 'play' ? 'play' : null,
      entitlement_start_date: existingEntitlement.entitlement_start_date || null,
      entitlement_end_date: expiryTime || null,
      ai_requests_this_month: typeof existingEntitlement.ai_requests_this_month === 'number' ? existingEntitlement.ai_requests_this_month : 0,
      ai_requests_reset_date: existingEntitlement.ai_requests_reset_date || nextResetDate,
      usage_reset_month: existingEntitlement.usage_reset_month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      gemini_credits_used: typeof existingEntitlement.gemini_credits_used === 'number' ? existingEntitlement.gemini_credits_used : 0,
      gemini_credits_limit: typeof existingEntitlement.gemini_credits_limit === 'number' ? existingEntitlement.gemini_credits_limit : (tier === 'pro' ? 100 : 5),
      play_product_id: verifiedProductId,
      play_purchase_token_hash: hashPurchaseToken(purchaseToken || null),
      play_last_order_id: latestOrderId || null,
      play_auto_renewing: autoRenewFlag,
      play_state: playState || null,
      last_verified_at: nowIso,
    };

    if (tier === 'pro' && !existingEntitlement.entitlement_start_date) {
      mergedEntitlement.entitlement_start_date = nowIso;
    }
    if (tier === 'free' && !mergedEntitlement.entitlement_start_date) {
      mergedEntitlement.entitlement_start_date = null;
    }

    await userRef.set({ entitlement: mergedEntitlement }, { merge: true });

    return res.json({
      status,
      source: GOOGLE_PLAY_VERIFICATION_ENABLED ? 'play_verified' : 'play_client_fallback',
      entitlement: mergedEntitlement,
      verificationEnabled: GOOGLE_PLAY_VERIFICATION_ENABLED,
    });
  } catch (error: any) {
    console.error('Play subscription sync failed:', error?.message || error);
    return res.status(500).json({ error: 'Play subscription sync failed' });
  }
});

app.post('/api/paystack/init-payment', async (req, res) => {
  try {
    const { userId, email, plan } = req.body;
    
    if (!userId || !email || !plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }
    
    const planConfig = PLANS[plan as keyof typeof PLANS];
    if (!planConfig) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    
    const reference = `fampal_${plan}_${userId}_${Date.now()}`;
    const callbackUrl = `${APP_URL}?payment_callback=true&ref=${reference}`;
    
    let paystackPayload: any = {
      email,
      amount: planConfig.amount,
      currency: planConfig.currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        userId,
        plan,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: plan },
          { display_name: 'User ID', variable_name: 'user_id', value: userId }
        ]
      }
    };
    
    if (plan === 'pro' && planConfig.plan_code) {
      paystackPayload.plan = planConfig.plan_code;
    }
    
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackPayload),
    });
    
    const data = await response.json();
    
    if (!data.status) {
      console.error('Paystack init error:', data);
      return res.status(400).json({ error: data.message || 'Payment initialization failed' });
    }
    
    return res.json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    });
  } catch (error) {
    console.error('Payment init error:', error);
    return res.status(500).json({ error: 'Payment initialization failed' });
  }
});

app.post('/api/paystack/verify', async (req, res) => {
  try {
    const { reference } = req.body;
    
    if (!reference || !PAYSTACK_SECRET_KEY) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });
    
    const data = await response.json();
    
    if (!data.status || data.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment not verified' });
    }
    
    const metadata = data.data.metadata;
    const userId = metadata?.userId;
    const plan = metadata?.plan;
    
    if (userId && plan) {
      await updateUserEntitlement(userId, plan, data.data.reference, data.data);
    }
    
    return res.json({ success: true, plan });
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/paystack/webhook', async (req: any, res) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    
    if (!signature || !verifyPaystackSignature(req.rawBody, signature)) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const event = req.body;
    console.log('Paystack webhook event:', event.event);
    
    switch (event.event) {
      case 'charge.success':
      case 'subscription.create': {
        const metadata = event.data.metadata;
        const userId = metadata?.userId;
        const plan = metadata?.plan;
        
        if (userId && plan) {
          await updateUserEntitlement(userId, plan, event.data.reference, event.data);
          console.log(`Updated entitlement for user ${userId} to ${plan}`);
        }
        break;
      }
      
      case 'subscription.disable':
      case 'subscription.not_renew': {
        const subscriptionCode = event.data.subscription_code;
        const userSnapshot = await db.collection('users')
          .where('entitlement.paystack_subscription_code', '==', subscriptionCode)
          .limit(1)
          .get();
        
        if (!userSnapshot.empty) {
          const userDoc = userSnapshot.docs[0];
          const userData = userDoc.data() as Record<string, any> | undefined;
          if (isAdminAccessUser(userData)) {
            console.log(`[FamPal API] Skipped cancellation downgrade for admin/review account ${userDoc.id}`);
            break;
          }
          await userDoc.ref.update({
            'entitlement.plan_status': 'cancelled',
          });
          console.log(`Cancelled subscription for user ${userDoc.id}`);
        }
        break;
      }
      
      case 'invoice.payment_failed': {
        const customerCode = event.data.customer?.customer_code;
        if (customerCode) {
          const userSnapshot = await db.collection('users')
            .where('entitlement.paystack_customer_code', '==', customerCode)
            .limit(1)
            .get();
          
          if (!userSnapshot.empty) {
            const userDoc = userSnapshot.docs[0];
            const userData = userDoc.data() as Record<string, any> | undefined;
            if (isAdminAccessUser(userData)) {
              console.log(`[FamPal API] Skipped expiry downgrade for admin/review account ${userDoc.id}`);
              break;
            }
            await userDoc.ref.update({
              'entitlement.plan_status': 'expired',
            });
          }
        }
        break;
      }
    }
    
    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/api/subscription/cancel', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId || !PAYSTACK_SECRET_KEY) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    if (isAdminAccessUser(userData as Record<string, any> | undefined)) {
      return res.json({ success: true, skipped: true, reason: 'admin_review_account' });
    }
    const subscriptionCode = userData?.entitlement?.paystack_subscription_code;
    const emailToken = userData?.entitlement?.paystack_email_token;
    
    if (!subscriptionCode) {
      return res.status(400).json({ error: 'No active subscription' });
    }
    
    const response = await fetch(`https://api.paystack.co/subscription/disable`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: subscriptionCode, token: emailToken }),
    });
    
    const data = await response.json();
    
    if (data.status) {
      await userDoc.ref.update({
        'entitlement.plan_status': 'cancelled',
      });
      return res.json({ success: true });
    }
    
    return res.status(400).json({ error: 'Failed to cancel subscription' });
  } catch (error) {
    console.error('Cancel error:', error);
    return res.status(500).json({ error: 'Cancellation failed' });
  }
});

async function updateUserEntitlement(
  userId: string, 
  plan: string, 
  reference: string,
  paymentData: any
) {
  const userRef = db.collection('users').doc(userId);
  const existingUserDoc = await userRef.get();
  const existingUserData = existingUserDoc.exists ? (existingUserDoc.data() as Record<string, any>) : undefined;
  if (isAdminAccessUser(existingUserData)) {
    console.log(`[FamPal API] Skipped entitlement overwrite for admin/review account ${userId}`);
    return;
  }
  const now = new Date();
  let endDate: string | null = null;
  const oneMonthLater = new Date(now);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  endDate = oneMonthLater.toISOString();
  
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  
  const entitlement = {
    plan_tier: 'pro' as const,
    plan_status: 'active',
    entitlement_source: 'paystack',
    entitlement_start_date: now.toISOString(),
    entitlement_end_date: endDate,
    paystack_customer_code: paymentData.customer?.customer_code || null,
    paystack_subscription_code: paymentData.subscription_code || null,
    paystack_email_token: paymentData.email_token || paymentData.subscription?.email_token || null,
    last_payment_reference: reference,
    ai_requests_this_month: 0,
    ai_requests_reset_date: nextMonth.toISOString(),
  };
  
  await userRef.set(
    { entitlement },
    { merge: true }
  );
}

app.get('/api/paystack/config', (_req, res) => {
  res.json({ 
    publicKey: PAYSTACK_PUBLIC_KEY,
    configured: !!PAYSTACK_SECRET_KEY 
  });
});

// Partner unlink endpoint - handles clearing both users' partnerLink fields
// This is needed because Firestore rules only allow users to write to their own documents
// Requires Firebase Auth token for security
app.post('/api/partner/unlink', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const currentPartnerLink = await getUserPartnerLink(userId);
    const actualPartnerUserId = currentPartnerLink?.partnerUserId ? String(currentPartnerLink.partnerUserId) : null;

    if (isPostgresEnabled) {
      const currentRow = await ensurePostgresUserRow(userId);
      const currentRaw = parsePgJson<Record<string, any>>(currentRow.raw, {});
      await pgQuery(
        `
          update users
          set partner_link = '{}'::jsonb,
              raw = $2::jsonb,
              updated_at = now()
          where id = $1
        `,
        [userId, JSON.stringify({ ...currentRaw, partnerLink: undefined })],
      );

      if (actualPartnerUserId) {
        const partnerRow = await ensurePostgresUserRow(actualPartnerUserId);
        const partnerRaw = parsePgJson<Record<string, any>>(partnerRow.raw, {});
        await pgQuery(
          `
            update users
            set partner_link = '{}'::jsonb,
                raw = $2::jsonb,
                updated_at = now()
            where id = $1
          `,
          [actualPartnerUserId, JSON.stringify({ ...partnerRaw, partnerLink: undefined })],
        );

        await pgQuery(
          `
            update partner_threads
            set status = 'closed',
                updated_at = now()
            where id = $1
          `,
          [getPartnerThreadIdForUsers(userId, actualPartnerUserId)],
        );
      }

      return res.json({ success: true });
    }

    const batch = db.batch();
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, { partnerLink: FieldValue.delete() });
    if (actualPartnerUserId) {
      const partnerRef = db.collection('users').doc(actualPartnerUserId);
      batch.update(partnerRef, { partnerLink: FieldValue.delete() });
      const threadRef = db.collection('partnerThreads').doc(getPartnerThreadIdForUsers(userId, actualPartnerUserId));
      batch.set(threadRef, { status: 'closed', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FamPal API] Partner unlink failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to unlink partner', details: err?.message });
  }
});

// Refresh partner status - returns current partner link info for the authenticated user
// Requires Firebase Auth token for security
app.get('/api/partner/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const partnerLink = await hydratePartnerLink(await getUserPartnerLink(userId));
    res.json({ partnerLink });
  } catch (err: any) {
    console.error('[FamPal API] Partner status fetch failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch partner status', details: err?.message });
  }
});

// Partner link endpoint - handles linking two users when accepting an invite code
// Requires Firebase Auth token for security
// Validates that the invite code matches the partner's pending code
app.post('/api/partner/link', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const inviteCode = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim().toUpperCase() : '';
    let partnerUserId = typeof req.body?.partnerUserId === 'string' ? req.body.partnerUserId.trim() : '';
    const selfName = typeof req.body?.selfName === 'string' ? req.body.selfName.trim() : '';

    let partnerMatch: { id: string; partnerLink: Record<string, any>; profile: { displayName: string | null; email: string | null; photoURL: string | null } } | null = null;
    if (inviteCode) {
      partnerMatch = await findPartnerByInviteCode(inviteCode, userId);
      if (!partnerMatch) {
        return res.status(404).json({ error: 'No partner found with this code' });
      }
      partnerUserId = partnerMatch.id;
    }

    if (!partnerUserId) {
      return res.status(400).json({ error: 'Missing partnerUserId or inviteCode' });
    }

    if (!partnerMatch) {
      const partnerLink = await getUserPartnerLink(partnerUserId);
      if (!partnerLink) {
        return res.status(404).json({ error: 'Partner not found' });
      }
      if (inviteCode && String(partnerLink.inviteCode || '').toUpperCase() !== inviteCode) {
        return res.status(403).json({ error: 'Invalid invite code' });
      }
      const hydrated = await hydratePartnerLink(partnerLink);
      partnerMatch = {
        id: partnerUserId,
        partnerLink,
        profile: {
          displayName: hydrated?.partnerName || null,
          email: hydrated?.partnerEmail || null,
          photoURL: hydrated?.partnerPhotoURL || null,
        },
      };
    }

    const partnerInviteCode = String(partnerMatch.partnerLink?.inviteCode || '').trim();
    const partnerStatus = String(partnerMatch.partnerLink?.status || '').trim();
    if (!partnerInviteCode || partnerStatus === 'accepted') {
      return res.status(400).json({ error: 'Partner does not have a pending invite or is already linked' });
    }

    if (inviteCode && partnerInviteCode.toUpperCase() !== inviteCode) {
      return res.status(403).json({ error: 'Invalid invite code' });
    }

    if (isPostgresEnabled) {
      const userRow = await ensurePostgresUserRow(userId);
      const partnerRow = await ensurePostgresUserRow(partnerUserId);
      const userProfile = getUserProfileSnapshot(userRow);
      const partnerProfile = getUserProfileSnapshot(partnerRow);
      const linkedAt = new Date().toISOString();

      const nextUserLink = {
        status: 'accepted',
        inviteCode: partnerInviteCode,
        linkedAt,
        partnerUserId,
        partnerName: partnerProfile.displayName || partnerProfile.email || 'Partner',
        partnerEmail: partnerProfile.email || undefined,
        partnerPhotoURL: partnerProfile.photoURL || undefined,
      };
      const nextPartnerLink = {
        status: 'accepted',
        inviteCode: partnerInviteCode,
        linkedAt,
        partnerUserId: userId,
        partnerName: userProfile.displayName || selfName || userProfile.email || 'Partner',
        partnerEmail: userProfile.email || undefined,
        partnerPhotoURL: userProfile.photoURL || undefined,
      };

      const userRaw = parsePgJson<Record<string, any>>(userRow.raw, {});
      const partnerRaw = parsePgJson<Record<string, any>>(partnerRow.raw, {});
      await pgQuery(
        `
          update users
          set partner_link = $2::jsonb,
              raw = $3::jsonb,
              updated_at = now()
          where id = $1
        `,
        [userId, JSON.stringify(nextUserLink), JSON.stringify({ ...userRaw, partnerLink: nextUserLink })],
      );
      await pgQuery(
        `
          update users
          set partner_link = $2::jsonb,
              raw = $3::jsonb,
              updated_at = now()
          where id = $1
        `,
        [partnerUserId, JSON.stringify(nextPartnerLink), JSON.stringify({ ...partnerRaw, partnerLink: nextPartnerLink })],
      );

      await ensurePartnerThreadRecord(userId, partnerUserId);
      return res.json({ success: true, partnerLink: nextUserLink });
    }

    const partnerDoc = await db.collection('users').doc(partnerUserId).get();
    if (!partnerDoc.exists) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    const partnerData = partnerDoc.data() || {};
    const partnerProfile = partnerData.profile || {};
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userProfile = userData?.profile || {};
    const batch = db.batch();
    const userRef = db.collection('users').doc(userId);
    batch.set(userRef, {
      partnerLink: {
        status: 'accepted',
        inviteCode: partnerInviteCode,
        linkedAt: new Date().toISOString(),
        partnerUserId,
        partnerName: partnerProfile.displayName || partnerProfile.email || 'Partner',
        partnerEmail: partnerProfile.email,
        partnerPhotoURL: partnerProfile.photoURL,
      },
    }, { merge: true });
    const partnerRef = db.collection('users').doc(partnerUserId);
    batch.set(partnerRef, {
      partnerLink: {
        status: 'accepted',
        inviteCode: partnerInviteCode,
        linkedAt: new Date().toISOString(),
        partnerUserId: userId,
        partnerName: userProfile.displayName || selfName || userProfile.email || 'Partner',
        partnerEmail: userProfile.email,
        partnerPhotoURL: userProfile.photoURL,
      },
    }, { merge: true });
    const threadRef = db.collection('partnerThreads').doc(getPartnerThreadIdForUsers(userId, partnerUserId));
    batch.set(threadRef, {
      members: [userId, partnerUserId],
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    }, { merge: true });
    await batch.commit();
    res.json({ 
      success: true, 
      partnerLink: {
        status: 'accepted',
        partnerUserId,
        partnerName: partnerMatch.profile.displayName || partnerMatch.profile.email || 'Partner',
        partnerEmail: partnerMatch.profile.email || undefined,
        partnerPhotoURL: partnerMatch.profile.photoURL || undefined,
      }
    });
  } catch (err: any) {
    console.error('[FamPal API] Partner link failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to link partner', details: err?.message });
  }
});

app.get('/api/partner/thread', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const data = await loadPartnerThreadState(userId);
    return res.json(data);
  } catch (err: any) {
    console.error('[FamPal API] Partner thread load failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load partner thread' });
  }
});

app.post('/api/partner/thread/notes', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const createdByName = typeof req.body?.createdByName === 'string' ? req.body.createdByName.trim() : 'You';
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    const note = await savePartnerThreadNote(userId, text, createdByName);
    return res.json({ note });
  } catch (err: any) {
    console.error('[FamPal API] Partner note save failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save partner note' });
  }
});

app.put('/api/partner/thread/places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const placeId = String(req.params.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const place = isRecord(req.body?.place) ? req.body.place : {};
    await savePartnerThreadPlace(userId, placeId, place);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Partner shared place save failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save partner shared place' });
  }
});

app.put('/api/partner/thread/memories/:memoryId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const memoryId = String(req.params.memoryId || '').trim();
    if (!memoryId) {
      return res.status(400).json({ error: 'memoryId is required' });
    }
    const memory = isRecord(req.body?.memory) ? req.body.memory : {};
    await savePartnerThreadMemory(userId, memoryId, memory);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Partner shared memory save failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save partner shared memory' });
  }
});

app.patch('/api/partner/thread/family-pool', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const familyPool = isRecord(req.body?.familyPool) ? req.body.familyPool : {};
    const nextFamilyPool = await savePartnerThreadFamilyPool(userId, familyPool);
    return res.json({ familyPool: nextFamilyPool });
  } catch (err: any) {
    console.error('[FamPal API] Partner family pool save failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save family pool' });
  }
});

// ─── Place Owner Claim & Management ─────────────────────────────────────

app.post('/api/place-claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const { placeId, placeName, businessRole, businessEmail, businessPhone, verificationMethod, verificationEvidence } = req.body;

    if (!placeId || !placeName || !businessRole || !verificationEvidence) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (isPostgresEnabled) {
      await ensurePostgresPlace(placeId, placeName);
      const userRecord = await ensurePostgresUser(userId);

      const existing = await pgQuery<{ exists: number }>(
        `select 1 as exists from place_claims where place_id = $1 and user_id = $2 and status = 'pending' limit 1`,
        [placeId, userId],
      );
      if (existing.rowCount) {
        return res.status(409).json({ error: 'You already have a pending claim for this place' });
      }

      const verifiedExisting = await pgQuery<{ exists: number }>(
        `select 1 as exists from place_claims where place_id = $1 and status = 'verified' limit 1`,
        [placeId],
      );
      if (verifiedExisting.rowCount) {
        return res.status(409).json({ error: 'This place already has a verified owner' });
      }

      const claimId = crypto.randomUUID();
      await pgQuery(
        `
          insert into place_claims (
            id, place_id, user_id, status, business_role, business_email, business_phone,
            verification_method, verification_evidence, raw, created_at
          )
          values ($1, $2, $3, 'pending', $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
        `,
        [
          claimId,
          placeId,
          userId,
          businessRole,
          businessEmail || null,
          businessPhone || null,
          verificationMethod || 'manual',
          JSON.stringify(verificationEvidence),
          JSON.stringify({
            placeName,
            userEmail: userRecord.email,
            userDisplayName: userRecord.displayName || '',
            source: 'postgres',
          }),
        ],
      );

      await pgQuery(
        `update places set owner_status = 'pending', updated_at = now() where id = $1`,
        [placeId],
      );

      console.log(`[FamPal API] Place claim submitted via Postgres: ${claimId} for place ${placeId} by ${userId}`);
      return res.json({ success: true, claimId });
    }

    const existing = await db.collection('placeClaims')
      .where('placeId', '==', placeId)
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .get();

    if (!existing.empty) {
      return res.status(409).json({ error: 'You already have a pending claim for this place' });
    }

    const verifiedExisting = await db.collection('placeClaims')
      .where('placeId', '==', placeId)
      .where('status', '==', 'verified')
      .get();

    if (!verifiedExisting.empty) {
      return res.status(409).json({ error: 'This place already has a verified owner' });
    }

    const userRecord = await adminAuth.getUser(userId);

    const claim = {
      placeId,
      placeName,
      userId,
      userEmail: userRecord.email || '',
      userDisplayName: userRecord.displayName || '',
      status: 'pending',
      businessRole,
      businessEmail: businessEmail || null,
      businessPhone: businessPhone || null,
      verificationMethod: verificationMethod || 'manual',
      verificationEvidence,
      createdAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('placeClaims').add(claim);

    await db.collection('places').doc(placeId).set({
      ownerStatus: 'pending',
    }, { merge: true });

    console.log(`[FamPal API] Place claim submitted: ${docRef.id} for place ${placeId} by ${userId}`);
    res.json({ success: true, claimId: docRef.id });
  } catch (err: any) {
    console.error('[FamPal API] Place claim submission failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to submit claim' });
  }
});

app.get('/api/place-claims/my-claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;

    if (isPostgresEnabled) {
      const result = await pgQuery<PostgresPlaceClaimRow>(
        `
          select
            pc.*,
            p.name as place_name,
            u.email as user_email,
            u.display_name as user_display_name
          from place_claims pc
          left join places p on p.id = pc.place_id
          left join users u on u.id = pc.user_id
          where pc.user_id = $1
          order by pc.created_at desc
        `,
        [userId],
      );
      return res.json({ claims: result.rows.map(mapPostgresPlaceClaim) });
    }

    const snapshot = await db.collection('placeClaims')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const claims = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt,
        reviewedAt: data.reviewedAt?.toDate?.()?.toISOString?.() || data.reviewedAt,
      };
    });
    res.json({ claims });
  } catch (err: any) {
    console.error('[FamPal API] Fetch my claims failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

app.get('/api/place-claims/place/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { placeId } = req.params;
    const userId = req.uid!;

    if (isPostgresEnabled) {
      const result = await pgQuery<PostgresPlaceClaimRow>(
        `
          select
            pc.*,
            p.name as place_name,
            u.email as user_email,
            u.display_name as user_display_name
          from place_claims pc
          left join places p on p.id = pc.place_id
          left join users u on u.id = pc.user_id
          where pc.place_id = $1 and pc.user_id = $2
          order by pc.created_at desc
          limit 1
        `,
        [placeId, userId],
      );
      if (!result.rowCount) {
        return res.json({ claim: null });
      }
      return res.json({ claim: mapPostgresPlaceClaim(result.rows[0]) });
    }

    const snapshot = await db.collection('placeClaims')
      .where('placeId', '==', placeId)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.json({ claim: null });
    }

    const doc = snapshot.docs[0];
    res.json({ claim: { id: doc.id, ...doc.data() } });
  } catch (err: any) {
    console.error('[FamPal API] Fetch place claim failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch claim' });
  }
});

app.get('/api/admin/place-claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    if (!(await isAdminUserViaFirestore(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const status = (req.query.status as string) || 'pending';

    if (isPostgresEnabled) {
      const result = await pgQuery<PostgresPlaceClaimRow>(
        `
          select
            pc.*,
            p.name as place_name,
            u.email as user_email,
            u.display_name as user_display_name
          from place_claims pc
          left join places p on p.id = pc.place_id
          left join users u on u.id = pc.user_id
          where pc.status = $1
          order by pc.created_at desc
          limit 50
        `,
        [status],
      );
      return res.json({ claims: result.rows.map(mapPostgresPlaceClaim) });
    }

    const snapshot = await db.collection('placeClaims')
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const claims = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt,
        reviewedAt: data.reviewedAt?.toDate?.()?.toISOString?.() || data.reviewedAt,
      };
    });
    res.json({ claims });
  } catch (err: any) {
    console.error('[FamPal API] Admin fetch claims failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

app.post('/api/admin/place-claims/:claimId/verify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminUserId = req.uid!;
    if (!(await isAdminUserViaFirestore(adminUserId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const claimId = req.params.claimId as string;
    const { action, rejectionReason } = req.body;

    if (!['verify', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (isPostgresEnabled) {
      const claimData = await getPostgresPlaceClaimById(claimId);
      if (!claimData) {
        return res.status(404).json({ error: 'Claim not found' });
      }

      if (action === 'verify') {
        await pgQuery(
          `
            update place_claims
            set status = 'verified',
                reviewed_at = now(),
                reviewed_by = $2
            where id = $1
          `,
          [claimId, adminUserId],
        );

        await pgQuery(
          `
            update places
            set owner_status = 'verified',
                owner_tier = 'free',
                owner_ids = case
                  when $2 = any(coalesce(owner_ids, '{}'::text[])) then coalesce(owner_ids, '{}'::text[])
                  else array_append(coalesce(owner_ids, '{}'::text[]), $2)
                end,
                updated_at = now()
            where id = $1
          `,
          [claimData.place_id, claimData.user_id],
        );

        await pgQuery(
          `
            insert into place_owner_profiles (
              id, place_id, user_id, tier, owner_content, raw, verified_at, last_updated_at
            )
            values ($1, $2, $3, 'free', '{}'::jsonb, '{}'::jsonb, now(), now())
            on conflict (place_id, user_id) do update
            set tier = excluded.tier,
                verified_at = excluded.verified_at,
                last_updated_at = excluded.last_updated_at
          `,
          [`${claimData.place_id}_${claimData.user_id}`, claimData.place_id, claimData.user_id],
        );

        console.log(`[FamPal API] Claim ${claimId} verified in Postgres for place ${claimData.place_id}`);
      } else {
        await pgQuery(
          `
            update place_claims
            set status = 'rejected',
                rejection_reason = $2,
                reviewed_at = now(),
                reviewed_by = $3
            where id = $1
          `,
          [claimId, rejectionReason || 'Insufficient evidence', adminUserId],
        );

        await pgQuery(
          `update places set owner_status = 'none', updated_at = now() where id = $1`,
          [claimData.place_id],
        );

        console.log(`[FamPal API] Claim ${claimId} rejected in Postgres for place ${claimData.place_id}`);
      }

      return res.json({ success: true, status: action === 'verify' ? 'verified' : 'rejected' });
    }

    const claimRef = db.collection('placeClaims').doc(claimId);
    const claimDoc = await claimRef.get();

    if (!claimDoc.exists) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const claimData = claimDoc.data()!;
    const batch = db.batch();

    if (action === 'verify') {
      batch.update(claimRef, {
        status: 'verified',
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: adminUserId,
      });

      const placeRef = db.collection('places').doc(claimData.placeId);
      batch.set(placeRef, {
        ownerStatus: 'verified',
        ownerTier: 'free',
        ownerIds: FieldValue.arrayUnion(claimData.userId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const ownerProfileRef = db.collection('placeOwnerProfiles').doc(`${claimData.placeId}_${claimData.userId}`);
      batch.set(ownerProfileRef, {
        placeId: claimData.placeId,
        userId: claimData.userId,
        tier: 'free',
        verifiedAt: new Date().toISOString(),
        ownerContent: {},
        lastUpdatedAt: new Date().toISOString(),
      });

      console.log(`[FamPal API] Claim ${claimId} verified for place ${claimData.placeId}`);
    } else {
      batch.update(claimRef, {
        status: 'rejected',
        rejectionReason: rejectionReason || 'Insufficient evidence',
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: adminUserId,
      });

      batch.set(db.collection('places').doc(claimData.placeId), {
        ownerStatus: 'none',
      }, { merge: true });

      console.log(`[FamPal API] Claim ${claimId} rejected for place ${claimData.placeId}`);
    }

    await batch.commit();
    res.json({ success: true, status: action === 'verify' ? 'verified' : 'rejected' });
  } catch (err: any) {
    console.error('[FamPal API] Admin claim verification failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to process claim' });
  }
});

app.get('/api/place-owner/:placeId', async (req: Request, res: Response) => {
  try {
    const placeId = req.params.placeId as string;

    if (isPostgresEnabled) {
      const result = await pgQuery<{
        owner_status: string | null;
        owner_tier: string | null;
        owner_content: unknown;
        raw: unknown;
      }>(
        `select owner_status, owner_tier, owner_content, raw from places where id = $1 limit 1`,
        [placeId],
      );
      if (!result.rowCount) {
        return res.json({ ownerStatus: 'none', ownerContent: null });
      }
      const row = result.rows[0];
      const raw = parsePgJson<Record<string, any>>(row.raw, {});
      return res.json({
        ownerStatus: row.owner_status || 'none',
        ownerTier: row.owner_tier || null,
        ownerContent: parsePgJson(row.owner_content, null),
        promotedUntil: raw.promotedUntil || null,
      });
    }

    const placeDoc = await db.collection('places').doc(placeId).get();

    if (!placeDoc.exists) {
      return res.json({ ownerStatus: 'none', ownerContent: null });
    }

    const data = placeDoc.data()!;
    res.json({
      ownerStatus: data.ownerStatus || 'none',
      ownerTier: data.ownerTier || null,
      ownerContent: data.ownerContent || null,
      promotedUntil: data.promotedUntil || null,
    });
  } catch (err: any) {
    console.error('[FamPal API] Fetch place owner info failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch owner info' });
  }
});

app.put('/api/place-owner/:placeId/content', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const placeId = req.params.placeId as string;
    const { ownerContent } = req.body;

    if (isPostgresEnabled) {
      const result = await pgQuery<{
        owner_ids: string[] | null;
        owner_tier: string | null;
      }>(
        `select owner_ids, owner_tier from places where id = $1 limit 1`,
        [placeId],
      );
      if (!result.rowCount) {
        return res.status(404).json({ error: 'Place not found' });
      }

      const placeRow = result.rows[0];
      const ownerIds = placeRow.owner_ids || [];
      if (!ownerIds.includes(userId)) {
        return res.status(403).json({ error: 'You are not a verified owner of this place' });
      }

      const tier = placeRow.owner_tier || 'free';
      const sanitized = { ...ownerContent };
      if (tier === 'free') {
        delete sanitized.specialOffers;
        delete sanitized.events;
        delete sanitized.photos;
      }

      await ensurePostgresUser(userId);
      await pgQuery(
        `update places set owner_content = $2::jsonb, updated_at = now() where id = $1`,
        [placeId, JSON.stringify(sanitized)],
      );
      await pgQuery(
        `
          insert into place_owner_profiles (id, place_id, user_id, owner_content, last_updated_at)
          values ($1, $2, $3, $4::jsonb, now())
          on conflict (place_id, user_id) do update
          set owner_content = excluded.owner_content,
              last_updated_at = excluded.last_updated_at
        `,
        [`${placeId}_${userId}`, placeId, userId, JSON.stringify(sanitized)],
      );

      console.log(`[FamPal API] Owner content updated in Postgres for place ${placeId} by ${userId}`);
      return res.json({ success: true, ownerContent: sanitized });
    }

    const placeDoc = await db.collection('places').doc(placeId).get();
    if (!placeDoc.exists) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const placeData = placeDoc.data()!;
    if (!placeData.ownerIds?.includes(userId)) {
      return res.status(403).json({ error: 'You are not a verified owner of this place' });
    }

    const tier = placeData.ownerTier || 'free';
    const sanitized = { ...ownerContent };
    if (tier === 'free') {
      delete sanitized.specialOffers;
      delete sanitized.events;
      delete sanitized.photos;
    }

    await db.collection('places').doc(placeId).set({
      ownerContent: sanitized,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const profileId = `${placeId}_${userId}`;
    await db.collection('placeOwnerProfiles').doc(profileId).set({
      ownerContent: sanitized,
      lastUpdatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`[FamPal API] Owner content updated for place ${placeId} by ${userId}`);
    res.json({ success: true, ownerContent: sanitized });
  } catch (err: any) {
    console.error('[FamPal API] Owner content update failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

app.post('/api/paystack/init-business-payment', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const { placeId, email } = req.body;

    if (!placeId || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    const placeDoc = await db.collection('places').doc(placeId).get();
    if (!placeDoc.exists || !placeDoc.data()?.ownerIds?.includes(userId)) {
      return res.status(403).json({ error: 'You must be a verified owner' });
    }

    const planConfig = PLANS['business_pro'];
    const reference = `fampal_business_pro_${placeId}_${userId}_${Date.now()}`;
    const callbackUrl = `${APP_URL}?payment_callback=true&ref=${reference}&type=business`;

    const paystackPayload: any = {
      email,
      amount: planConfig.amount,
      currency: planConfig.currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        userId,
        placeId,
        plan: 'business_pro',
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: 'Business Pro' },
          { display_name: 'Place ID', variable_name: 'place_id', value: placeId },
        ],
      },
    };

    if (planConfig.plan_code) {
      paystackPayload.plan = planConfig.plan_code;
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackPayload),
    });

    const data = await response.json();

    if (!data.status) {
      console.error('[FamPal API] Paystack init failed:', data);
      return res.status(500).json({ error: 'Payment initialization failed' });
    }

    console.log(`[FamPal API] Business payment initialized: ${reference}`);
    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (err: any) {
    console.error('[FamPal API] Business payment init failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

app.post('/api/paystack/verify-business', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reference } = req.body;

    if (!reference || !PAYSTACK_SECRET_KEY) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = await response.json();

    if (!data.status || data.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment not verified' });
    }

    const metadata = data.data.metadata;
    const placeId = metadata?.placeId;
    const userId = metadata?.userId;

    if (placeId && userId) {
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);

      await db.collection('places').doc(placeId).set({
        ownerTier: 'business_pro',
        promotedUntil: endDate.toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const profileId = `${placeId}_${userId}`;
      await db.collection('placeOwnerProfiles').doc(profileId).set({
        tier: 'business_pro',
        lastUpdatedAt: new Date().toISOString(),
        paystack_reference: reference,
        paystack_subscription_code: data.data.subscription_code || null,
      }, { merge: true });

      if (isPostgresEnabled) {
        await ensurePostgresUser(userId);
        await ensurePostgresPlace(placeId, '');
        await pgQuery(
          `
            update places
            set owner_tier = 'business_pro',
                raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{promotedUntil}', to_jsonb($2::text), true),
                updated_at = now()
            where id = $1
          `,
          [placeId, endDate.toISOString()],
        );
        await pgQuery(
          `
            insert into place_owner_profiles (
              id, place_id, user_id, tier, paystack_reference, paystack_subscription_code, last_updated_at
            )
            values ($1, $2, $3, 'business_pro', $4, $5, now())
            on conflict (place_id, user_id) do update
            set tier = excluded.tier,
                paystack_reference = excluded.paystack_reference,
                paystack_subscription_code = excluded.paystack_subscription_code,
                last_updated_at = excluded.last_updated_at
          `,
          [profileId, placeId, userId, reference, data.data.subscription_code || null],
        );
      }

      console.log(`[FamPal API] Business Pro activated for place ${placeId}`);
    }

    res.json({ success: true, status: 'active' });
  } catch (err: any) {
    console.error('[FamPal API] Business payment verification failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

const VALID_DELETION_CATEGORIES = ['saved_places', 'search_history', 'reviews_notes', 'profile_preferences', 'partner_circles'];

app.get('/api/circles', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circles = await listUserCirclesData(req.uid!);
    return res.json({ circles });
  } catch (err: any) {
    console.error('[FamPal API] Failed to list circles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to list circles' });
  }
});

app.post('/api/circles', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const circle = await createCircleData(
      userId,
      name,
      {
        displayName: typeof req.body?.user?.displayName === 'string' ? req.body.user.displayName : null,
        email: typeof req.body?.user?.email === 'string' ? req.body.user.email : null,
      },
      {
        isPartnerCircle: req.body?.isPartnerCircle === true,
        partner: isRecord(req.body?.partner) ? req.body.partner : null,
      },
    );
    return res.json({ circle });
  } catch (err: any) {
    console.error('[FamPal API] Failed to create circle:', err?.message || err);
    return res.status(500).json({ error: 'Failed to create circle' });
  }
});

app.post('/api/circles/join', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }
    const circle = await joinCircleData(code, {
      uid: req.uid!,
      displayName: typeof req.body?.user?.displayName === 'string' ? req.body.user.displayName : null,
      email: typeof req.body?.user?.email === 'string' ? req.body.user.email : null,
    });
    return res.json({ circle });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_not_found') {
      return res.status(404).json({ error: 'No circle found for that code.' });
    }
    console.error('[FamPal API] Failed to join circle:', message);
    return res.status(500).json({ error: 'Failed to join circle' });
  }
});

app.get('/api/circles/:circleId/members', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const members = await listCircleMembersData(circleId, req.uid!);
    return res.json({ members });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to list circle members:', message);
    return res.status(500).json({ error: 'Failed to list circle members' });
  }
});

app.get('/api/circles/:circleId/places', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const places = await listCirclePlacesData(circleId, req.uid!);
    return res.json({ places });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to list circle places:', message);
    return res.status(500).json({ error: 'Failed to list circle places' });
  }
});

app.put('/api/circles/:circleId/places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const placeId = String(req.params.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const place = isRecord(req.body?.place) ? { ...req.body.place, placeId } : { placeId };
    await saveCirclePlaceData(circleId, req.uid!, place);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to save circle place:', message);
    return res.status(500).json({ error: 'Failed to save circle place' });
  }
});

app.delete('/api/circles/:circleId/places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const placeId = String(req.params.placeId || '').trim();
    await removeCirclePlaceData(circleId, req.uid!, placeId);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to remove circle place:', message);
    return res.status(500).json({ error: 'Failed to remove circle place' });
  }
});

app.get('/api/circles/:circleId/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const placeId = typeof req.query.placeId === 'string' ? req.query.placeId.trim() : '';
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const comments = await listCircleCommentsData(circleId, placeId, req.uid!);
    return res.json({ comments });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to list circle comments:', message);
    return res.status(500).json({ error: 'Failed to list circle comments' });
  }
});

app.post('/api/circles/:circleId/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const placeId = typeof req.body?.placeId === 'string' ? req.body.placeId.trim() : '';
    const comment = isRecord(req.body?.comment) ? req.body.comment : {};
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    await addCircleCommentData(circleId, req.uid!, placeId, comment);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to add circle comment:', message);
    return res.status(500).json({ error: 'Failed to add circle comment' });
  }
});

app.get('/api/circles/:circleId/memories', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const memories = await listCircleMemoriesData(circleId, req.uid!);
    return res.json({ memories });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to list circle memories:', message);
    return res.status(500).json({ error: 'Failed to list circle memories' });
  }
});

app.put('/api/circles/:circleId/memories/:memoryId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    const memoryId = String(req.params.memoryId || '').trim();
    if (!memoryId) {
      return res.status(400).json({ error: 'memoryId is required' });
    }
    const memory = isRecord(req.body?.memory) ? { ...req.body.memory, memoryId } : { memoryId };
    await addCircleMemoryData(circleId, req.uid!, memory);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_access_denied') {
      return res.status(403).json({ error: 'Circle access denied' });
    }
    console.error('[FamPal API] Failed to save circle memory:', message);
    return res.status(500).json({ error: 'Failed to save circle memory' });
  }
});

app.delete('/api/circles/:circleId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    await deleteCircleData(circleId, req.uid!);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_owner_required') {
      return res.status(403).json({ error: 'Only the circle owner can delete it' });
    }
    if (message === 'circle_not_found') {
      return res.status(404).json({ error: 'Circle not found' });
    }
    console.error('[FamPal API] Failed to delete circle:', message);
    return res.status(500).json({ error: 'Failed to delete circle' });
  }
});

app.post('/api/circles/:circleId/leave', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const circleId = String(req.params.circleId || '').trim();
    await leaveCircleData(circleId, req.uid!);
    return res.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || err;
    if (message === 'circle_owner_cannot_leave') {
      return res.status(400).json({ error: 'Owner cannot leave the circle. Delete it instead.' });
    }
    if (message === 'circle_not_found') {
      return res.status(404).json({ error: 'Circle not found' });
    }
    console.error('[FamPal API] Failed to leave circle:', message);
    return res.status(500).json({ error: 'Failed to leave circle' });
  }
});

app.get('/api/user/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const data = await loadUserState(userId);
    return res.json({ data });
  } catch (err: any) {
    console.error('[FamPal API] Failed to load user state:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load user state' });
  }
});

app.put('/api/user/me/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const profile = isRecord(req.body?.profile) ? req.body.profile : {};
    await upsertUserProfileData(userId, profile);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to save user profile:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save user profile' });
  }
});

app.patch('/api/user/me/field', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }
    await saveUserFieldData(userId, key, req.body?.value);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to save user field:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save user field' });
  }
});

app.get('/api/user/me/saved-places', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const savedPlaces = await listSavedPlaces(userId);
    return res.json({ places: savedPlaces });
  } catch (err: any) {
    console.error('[FamPal API] Failed to load saved places:', err?.message || err);
    return res.status(500).json({ error: 'Failed to load saved places' });
  }
});

app.put('/api/user/me/saved-places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const placeId = String(req.params.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const place = isRecord(req.body?.place) ? { ...req.body.place, placeId } : { placeId };
    await upsertSavedPlaceData(userId, place);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to save saved place:', err?.message || err);
    return res.status(500).json({ error: 'Failed to save saved place' });
  }
});

app.delete('/api/user/me/saved-places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const placeId = String(req.params.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    await deleteSavedPlaceData(userId, placeId);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to delete saved place:', err?.message || err);
    return res.status(500).json({ error: 'Failed to delete saved place' });
  }
});

app.post('/api/dev/grant-pro', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    const userId = req.uid!;
    const entitlement = isRecord(req.body?.entitlement) ? req.body.entitlement : null;
    if (!entitlement) {
      return res.status(400).json({ error: 'entitlement is required' });
    }
    await setUserEntitlementData(userId, entitlement);
    return res.json({ ok: true, entitlement });
  } catch (err: any) {
    console.error('[FamPal API] Failed to grant dev pro entitlement:', err?.message || err);
    return res.status(500).json({ error: 'Failed to grant dev entitlement' });
  }
});

// Gemini cache: <userID>:<model>:<contentsHash>
const geminiCache = new Map<string, { expiresAt: number; response: { text: string; usageMetadata?: any } }>();
const GEMINI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GEMINI_CACHE_MAX_ENTRIES = 1000;

function hashContents(contents: any): string {
  const str = JSON.stringify(contents);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

app.post('/api/gemini/generate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { model, contents, config, useCache = true } = req.body;
    if (!model || !contents) return res.status(400).json({ error: 'model and contents are required' });

    // Default to the original flash model, though typically the client passes the exact model
    const actualModel = model || 'gemini-1.5-flash';

    // Generate cache key based on user, model, and contents hash
    const contentsHash = hashContents(contents);
    const cacheKey = `${req.uid}:${actualModel}:${contentsHash}`;

    // Check cache if enabled
    if (useCache) {
      const cached = geminiCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.setHeader('X-Gemini-Cache', 'HIT');
        return res.json({ ...cached.response, cached: true });
      }
    }

    // Generate new response
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const response = await ai.models.generateContent({ model: actualModel, contents, config });
    const responseData = { text: response.text || '', usageMetadata: response.usageMetadata };

    // Store in cache
    if (useCache) {
      geminiCache.set(cacheKey, { expiresAt: Date.now() + GEMINI_CACHE_TTL_MS, response: responseData });

      // Clean up old entries if cache is too large
      if (geminiCache.size > GEMINI_CACHE_MAX_ENTRIES) {
        const oldest = geminiCache.entries().next().value;
        if (oldest) geminiCache.delete(oldest[0]);
      }

      res.setHeader('X-Gemini-Cache', 'MISS');
    }

    return res.json({ ...responseData, cached: false });
  } catch (err: any) {
    console.error('[FamPal API] Gemini error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to generate content' });
  }
});

// --- Phase 1 Migration Endpoints ---

app.get('/api/user/:uid', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const data = await loadUserState(req.uid);
    return res.json({ data });
  } catch (err: any) {
    console.error('[FamPal API] Failed to load user:', err);
    return res.status(500).json({ error: 'Failed to load user' });
  }
});

app.put('/api/user/:uid', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const profile = isRecord(req.body?.profile) ? req.body.profile : {};
    await upsertUserProfileData(req.uid, profile);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to update user:', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

app.patch('/api/user/:uid/entitlement', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const entitlement = req.body?.entitlement;
    if (!entitlement) return res.status(400).json({ error: 'entitlement required' });
    await setUserEntitlementData(req.uid, entitlement);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to update entitlement:', err);
    return res.status(500).json({ error: 'Failed to update entitlement' });
  }
});

app.get('/api/user/:uid/saved-places', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const places = await listSavedPlaces(req.uid);
    return res.json({ places });
  } catch (err: any) {
    console.error('[FamPal API] Failed to load saved places:', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

app.put('/api/user/:uid/saved-places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const placeId = String(req.params.placeId);
    const { savedPlace, placeSnapshot } = req.body;
    
    if (isPostgresEnabled) {
      await pgQuery(`
        INSERT INTO saved_places (user_id, place_id, place_name, formatted_address, rating, saved_at, payload, place_raw)
        VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
        ON CONFLICT (user_id, place_id) DO UPDATE
        SET payload = EXCLUDED.payload, place_raw = EXCLUDED.place_raw, saved_at = now()
      `, [req.uid, placeId, savedPlace?.name || null, savedPlace?.address || null, savedPlace?.rating || null, JSON.stringify(savedPlace || {}), JSON.stringify(placeSnapshot || {})]);
    } else {
      await db.collection('users').doc(req.uid).collection('savedPlaces').doc(placeId).set({ ...savedPlace, placeSnapshot, placeId }, { merge: true });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to save place:', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

app.delete('/api/user/:uid/saved-places/:placeId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const placeId = String(req.params.placeId);
    if (isPostgresEnabled) {
      await pgQuery(`DELETE FROM saved_places WHERE user_id = $1 AND place_id = $2`, [req.uid, placeId]);
    } else {
      await db.collection('users').doc(req.uid).collection('savedPlaces').doc(placeId).delete();
    }
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[FamPal API] Failed to delete place:', err);
    return res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/places/:placeId/contributions', async (req: Request, res: Response) => {
  try {
    const placeId = String(req.params.placeId);
    if (isPostgresEnabled) {
      const result = await pgQuery(`SELECT * FROM place_contributions WHERE place_id = $1`, [placeId]);
      return res.json({ contributions: result.rows });
    }
    const types = ['accessibility', 'familyFacilities', 'petFriendly'];
    let contributions: any[] = [];
    for (const type of types) {
      const snap = await db.collection('places').doc(placeId).collection(type).get();
      snap.forEach(doc => contributions.push({ id: doc.id, type, ...doc.data() }));
    }
    return res.json({ contributions });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/places/:placeId/contributions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const placeId = String(req.params.placeId);
    const { type, features, summary, visitVerified } = req.body;
    if (isPostgresEnabled) {
      const dbType = type === 'familyFacilities' ? 'family_facilities' : (type === 'petFriendly' ? 'pet_friendly' : type);
      await pgQuery(`
        INSERT INTO place_contributions (place_id, contribution_type, user_id, features, summary, visit_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (place_id, contribution_type, user_id) DO UPDATE
        SET features = EXCLUDED.features, summary = EXCLUDED.summary, updated_at = now()
      `, [placeId, dbType, req.uid, JSON.stringify(features || []), summary || null, visitVerified || false]);
    } else {
      await db.collection('places').doc(placeId).collection(type).doc(req.uid!).set({ features, summary, visitVerified, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/user/:uid/ai-credits/reserve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const { month } = req.body;
    const defaultLimit = 10;
    if (isPostgresEnabled) {
      const result = await pgQuery(`
        WITH current AS (
          SELECT used, monthly_limit, reset_month
          FROM ai_credits WHERE user_id = $1 FOR UPDATE
        ),
        reset_check AS (
          SELECT
            CASE WHEN reset_month != $2 THEN 0 ELSE used END as effective_used,
            monthly_limit,
            CASE WHEN reset_month != $2 THEN $2 ELSE reset_month END as new_reset_month
          FROM current
        )
        INSERT INTO ai_credits (user_id, used, monthly_limit, reset_month, last_used_at)
        VALUES ($1, 1, $3, $2, now())
        ON CONFLICT (user_id) DO UPDATE SET
          used = CASE WHEN ai_credits.reset_month != $2 THEN 1 ELSE ai_credits.used + 1 END,
          reset_month = $2,
          last_used_at = now()
        RETURNING used, monthly_limit, reset_month
      `, [req.uid, month, defaultLimit]);
      
      const row = result.rows[0];
      if (row.used > row.monthly_limit) {
        return res.status(429).json({ ok: false, used: row.used, limit: row.monthly_limit, remaining: 0, reason: 'limit_reached' });
      }
      return res.json({ ok: true, used: row.used, limit: row.monthly_limit, remaining: row.monthly_limit - row.used });
    } else {
      // Fallback for Firestore
      return res.json({ ok: true, used: 1, limit: defaultLimit, remaining: defaultLimit - 1 });
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/user/:uid/ai-credits/refund', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.uid !== req.params.uid) return res.status(403).json({ error: 'forbidden' });
    const { month } = req.body;
    if (isPostgresEnabled) {
      await pgQuery(`
        UPDATE ai_credits 
        SET used = GREATEST(0, used - 1)
        WHERE user_id = $1 AND reset_month = $2
      `, [req.uid, month]);
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/reports', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { placeId, contentType, contentId, reason, details } = req.body;
    if (isPostgresEnabled) {
      await pgQuery(`
        INSERT INTO community_reports (place_id, content_type, content_id, reported_by, reason, details)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [placeId, contentType, contentId, req.uid, reason, details]);
    } else {
      await db.collection('reports').add({
        placeId, contentType, contentId, reportedBy: req.uid, reason, details, createdAt: new Date().toISOString()
      });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed' });
  }
});

// --- End Phase 1 Migration Endpoints ---


app.post('/api/user/data-deletion', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!;
    const { categories } = req.body;

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'No categories specified' });
    }

    const invalid = categories.filter((c: string) => !VALID_DELETION_CATEGORIES.includes(c));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid categories: ${invalid.join(', ')}` });
    }

    console.log(`[FamPal API] Data deletion request from user ${userId}:`, {
      categories,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Data deletion request received. Selected data will be removed shortly.' });
  } catch (err: any) {
    console.error('[FamPal API] Data deletion request failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to process data deletion request' });
  }
});

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Serve Vite build in production
if (isProduction) {
  const distPath = path.join(__dirname, '../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// Start server immediately to satisfy Cloud Run health checks
const server = app.listen(Number(PORT), HOST, () => {
  console.log(`[FamPal API] Server running on ${HOST}:${PORT}`);
  console.log(`[FamPal API] listening on ${PORT}`);
  console.log(`[FamPal API] Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`[FamPal API] Paystack configured: ${!!PAYSTACK_SECRET_KEY}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('[FamPal API] Server error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[FamPal API] SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await closePostgresPool().catch((err) => {
      console.warn('[FamPal API] Failed to close Postgres pool cleanly:', err);
    });
    console.log('[FamPal API] Server closed');
    process.exit(0);
  });
});

