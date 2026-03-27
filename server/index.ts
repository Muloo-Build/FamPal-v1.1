import express, { Request, Response, NextFunction } from 'express';
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
console.log('[FamPals API] Starting server...');
console.log('[FamPals API] PORT env:', process.env.PORT);
console.log('[FamPals API] NODE_ENV:', process.env.NODE_ENV);

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
  console.warn('[FamPals API] PLACES_API_KEY is missing in production; places endpoints will remain unavailable until GOOGLE_PLACES_API_KEY or PLACES_API_KEY is configured.');
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

console.log('[FamPals API] Startup config:', {
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
    console.log('[FamPals Places] request', {
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
      console.log('[FamPals API] Initialized with explicit service account');
    } else {
      // Use ADC (works on Cloud Run, App Engine, Cloud Functions)
      initializeApp();
      console.log('[FamPals API] Initialized with Application Default Credentials');
    }
  }
  db = getFirestore();
  adminAuth = getAuth();
  console.log('[FamPals API] Firebase Admin SDK initialized successfully');
} catch (err) {
  console.error('[FamPals API] Firebase Admin init error:', err);
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

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
    console.error('[FamPals API] Auth verification failed:', err?.message);
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
    console.warn('[FamPals Refresh] PLACE_REFRESH_CRON_TOKEN missing; allowing local/dev execution.');
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
  console.log('[FamPals Refresh] completed', {
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
  console.warn('[FamPals API] Google Places API key is not configured. Places search will fail.');
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
    console.error('[FamPals Refresh] endpoint error', error);
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

    console.log(`[FamPals API] Explore intent selected: ${intent}`);
    console.log(`[FamPals API] Intent queries executed: ${queries.join(', ')}`);

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
          console.warn('[FamPals API] Intent text search warning:', data.status, data.error_message || '');
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

        console.log(`[FamPals API] Query "${query}" page ${page}: ${results.length} results, hasMore: ${!!data.next_page_token}`);
        console.log(`[FamPals API] Merge count after "${query}" page ${page}: ${mergedResults.length} before filter, ${filtered.length} after filter`);

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

    console.log(`[FamPals API] Intent "${intent}" filter counts: before=${mergedResults.length}, after=${filteredResults.length}`);

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
    
    const reference = `fampals_${plan}_${userId}_${Date.now()}`;
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
            console.log(`[FamPals API] Skipped cancellation downgrade for admin/review account ${userDoc.id}`);
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
              console.log(`[FamPals API] Skipped expiry downgrade for admin/review account ${userDoc.id}`);
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
    console.log(`[FamPals API] Skipped entitlement overwrite for admin/review account ${userId}`);
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
    const userId = req.uid!; // Verified user from auth token
    
    console.log('[FamPals API] Partner unlink request for user:', userId);
    
    // Fetch user's current partnerLink to get the actual partnerId
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data() || {};
    const currentPartnerLink = userData.partnerLink;
    
    // Get the actual partner from user's document (not from request body for security)
    const actualPartnerUserId = currentPartnerLink?.partnerUserId;
    
    console.log('[FamPals API] Validated partner from user doc:', actualPartnerUserId);
    
    const batch = db.batch();
    
    // Clear current user's partnerLink
    const userRef = db.collection('users').doc(userId);
    batch.update(userRef, { partnerLink: FieldValue.delete() });
    
    // If there's a valid partner link, clear their partnerLink too
    if (actualPartnerUserId) {
      const partnerRef = db.collection('users').doc(actualPartnerUserId);
      batch.update(partnerRef, { partnerLink: FieldValue.delete() });
      
      // Also mark the partner thread as closed
      const threadId = [userId, actualPartnerUserId].sort().join('_');
      const threadRef = db.collection('partnerThreads').doc(threadId);
      batch.set(threadRef, { status: 'closed', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    
    await batch.commit();
    console.log('[FamPals API] Partner unlink successful');
    
    res.json({ success: true });
  } catch (err: any) {
    console.error('[FamPals API] Partner unlink failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to unlink partner', details: err?.message });
  }
});

// Refresh partner status - returns current partner link info for the authenticated user
// Requires Firebase Auth token for security
app.get('/api/partner/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!; // Verified user from auth token
    
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.json({ partnerLink: null });
    }
    
    const userData = userDoc.data() || {};
    const partnerLink = userData.partnerLink ? { ...userData.partnerLink } : null;
    
    // If linked, also get partner's current profile info
    if (partnerLink?.partnerUserId) {
      const partnerDoc = await db.collection('users').doc(partnerLink.partnerUserId).get();
      if (partnerDoc.exists) {
        const partnerData = partnerDoc.data() || {};
        const partnerProfile = partnerData.profile || {};
        partnerLink.partnerName = partnerProfile.displayName || partnerLink.partnerName;
        partnerLink.partnerEmail = partnerProfile.email || partnerLink.partnerEmail;
        partnerLink.partnerPhotoURL = partnerProfile.photoURL || partnerLink.partnerPhotoURL;
      }
    }
    
    res.json({ partnerLink });
  } catch (err: any) {
    console.error('[FamPals API] Partner status fetch failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch partner status', details: err?.message });
  }
});

// Partner link endpoint - handles linking two users when accepting an invite code
// Requires Firebase Auth token for security
// Validates that the invite code matches the partner's pending code
app.post('/api/partner/link', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.uid!; // Verified user from auth token
    const { partnerUserId, partnerName, selfName, inviteCode } = req.body;
    
    if (!partnerUserId) {
      return res.status(400).json({ error: 'Missing partnerUserId' });
    }
    
    console.log('[FamPals API] Partner link request:', { userId, partnerUserId });
    
    // Get partner's info and validate invite code
    const partnerDoc = await db.collection('users').doc(partnerUserId).get();
    if (!partnerDoc.exists) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    const partnerData = partnerDoc.data() || {};
    const partnerProfile = partnerData.profile || {};
    
    // Validate invite code matches partner's pending invite
    const partnerInviteCode = partnerData.partnerLink?.inviteCode;
    const partnerStatus = partnerData.partnerLink?.status;
    
    // If invite code is provided, validate it matches
    if (inviteCode && partnerInviteCode !== inviteCode) {
      console.log('[FamPals API] Invite code mismatch:', { provided: inviteCode, expected: partnerInviteCode });
      return res.status(403).json({ error: 'Invalid invite code' });
    }
    
    // Validate partner has a pending invite code
    if (!partnerInviteCode || partnerStatus === 'accepted') {
      console.log('[FamPals API] Partner does not have a pending invite or is already linked');
      return res.status(400).json({ error: 'Partner does not have a pending invite or is already linked' });
    }
    
    // Get current user's info to update partner's record
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const userProfile = userData?.profile || {};
    
    const batch = db.batch();
    
    // Update current user's partnerLink to accepted
    const userRef = db.collection('users').doc(userId);
    batch.set(userRef, {
      partnerLink: {
        status: 'accepted',
        inviteCode: partnerData.partnerLink?.inviteCode || '',
        createdAt: FieldValue.serverTimestamp(),
        partnerUserId,
        partnerName: partnerProfile.displayName || partnerName || 'Partner',
        partnerEmail: partnerProfile.email,
        partnerPhotoURL: partnerProfile.photoURL,
      }
    }, { merge: true });
    
    // Update partner's partnerLink to mark them as linked
    const partnerRef = db.collection('users').doc(partnerUserId);
    batch.set(partnerRef, {
      partnerLink: {
        status: 'accepted',
        inviteCode: partnerData.partnerLink?.inviteCode || '',
        createdAt: FieldValue.serverTimestamp(),
        partnerUserId: userId,
        partnerName: userProfile.displayName || selfName || 'Partner',
        partnerEmail: userProfile.email,
        partnerPhotoURL: userProfile.photoURL,
      }
    }, { merge: true });
    
    // Create partner thread
    const threadId = [userId, partnerUserId].sort().join('_');
    const threadRef = db.collection('partnerThreads').doc(threadId);
    batch.set(threadRef, {
      members: [userId, partnerUserId],
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    }, { merge: true });
    
    await batch.commit();
    console.log('[FamPals API] Partner link successful');
    
    res.json({ 
      success: true, 
      partnerLink: {
        status: 'accepted',
        partnerUserId,
        partnerName: partnerProfile.displayName || partnerName || 'Partner',
        partnerEmail: partnerProfile.email,
        partnerPhotoURL: partnerProfile.photoURL,
      }
    });
  } catch (err: any) {
    console.error('[FamPals API] Partner link failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to link partner', details: err?.message });
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

      console.log(`[FamPals API] Place claim submitted via Postgres: ${claimId} for place ${placeId} by ${userId}`);
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

    console.log(`[FamPals API] Place claim submitted: ${docRef.id} for place ${placeId} by ${userId}`);
    res.json({ success: true, claimId: docRef.id });
  } catch (err: any) {
    console.error('[FamPals API] Place claim submission failed:', err?.message || err);
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
    console.error('[FamPals API] Fetch my claims failed:', err?.message || err);
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
    console.error('[FamPals API] Fetch place claim failed:', err?.message || err);
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
    console.error('[FamPals API] Admin fetch claims failed:', err?.message || err);
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

        console.log(`[FamPals API] Claim ${claimId} verified in Postgres for place ${claimData.place_id}`);
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

        console.log(`[FamPals API] Claim ${claimId} rejected in Postgres for place ${claimData.place_id}`);
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

      console.log(`[FamPals API] Claim ${claimId} verified for place ${claimData.placeId}`);
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

      console.log(`[FamPals API] Claim ${claimId} rejected for place ${claimData.placeId}`);
    }

    await batch.commit();
    res.json({ success: true, status: action === 'verify' ? 'verified' : 'rejected' });
  } catch (err: any) {
    console.error('[FamPals API] Admin claim verification failed:', err?.message || err);
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
    console.error('[FamPals API] Fetch place owner info failed:', err?.message || err);
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

      console.log(`[FamPals API] Owner content updated in Postgres for place ${placeId} by ${userId}`);
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

    console.log(`[FamPals API] Owner content updated for place ${placeId} by ${userId}`);
    res.json({ success: true, ownerContent: sanitized });
  } catch (err: any) {
    console.error('[FamPals API] Owner content update failed:', err?.message || err);
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
    const reference = `fampals_business_pro_${placeId}_${userId}_${Date.now()}`;
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
      console.error('[FamPals API] Paystack init failed:', data);
      return res.status(500).json({ error: 'Payment initialization failed' });
    }

    console.log(`[FamPals API] Business payment initialized: ${reference}`);
    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (err: any) {
    console.error('[FamPals API] Business payment init failed:', err?.message || err);
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

      console.log(`[FamPals API] Business Pro activated for place ${placeId}`);
    }

    res.json({ success: true, status: 'active' });
  } catch (err: any) {
    console.error('[FamPals API] Business payment verification failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

const VALID_DELETION_CATEGORIES = ['saved_places', 'search_history', 'reviews_notes', 'profile_preferences', 'partner_circles'];

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

    console.log(`[FamPals API] Data deletion request from user ${userId}:`, {
      categories,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Data deletion request received. Selected data will be removed shortly.' });
  } catch (err: any) {
    console.error('[FamPals API] Data deletion request failed:', err?.message || err);
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
  console.log(`[FamPals API] Server running on ${HOST}:${PORT}`);
  console.log(`[FamPals API] listening on ${PORT}`);
  console.log(`[FamPals API] Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`[FamPals API] Paystack configured: ${!!PAYSTACK_SECRET_KEY}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('[FamPals API] Server error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[FamPals API] SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await closePostgresPool().catch((err) => {
      console.warn('[FamPals API] Failed to close Postgres pool cleanly:', err);
    });
    console.log('[FamPals API] Server closed');
    process.exit(0);
  });
});

