// userData.ts — Railway Postgres API only. Firebase is used for auth only.
import { auth } from './firebase';
import type { SavedPlace } from '../types';

type Unsubscribe = () => void;

const DEV_AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
const USER_SYNC_POLL_MS = 10000;

function stripUndefined(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    try { return value.toDate().toISOString(); } catch { return undefined; }
  }
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
    try { return new Date(value.toMillis()).toISOString(); } catch { return undefined; }
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const cleaned: Record<string, any> = {};
    Object.entries(value).forEach(([key, val]) => {
      const nextVal = stripUndefined(val);
      if (nextVal !== undefined) cleaned[key] = nextVal;
    });
    return cleaned;
  }
  return value;
}

const CLIENT_WRITABLE_ENTITLEMENT_KEYS = new Set([
  'gemini_credits_used',
  'gemini_credits_limit',
  'usage_reset_month',
  'ai_requests_this_month',
  'ai_requests_reset_date',
]);

function sanitizeClientEntitlementPatch(value: any): Record<string, any> {
  if (!value || typeof value !== 'object') return {};
  const patch: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    if (!CLIENT_WRITABLE_ENTITLEMENT_KEYS.has(key)) continue;
    patch[key] = stripUndefined(val);
  }
  return patch;
}

async function getAuthHeaders(uid: string): Promise<Record<string, string>> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    throw new Error('auth_user_unavailable');
  }
  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiRequest<T>(uid: string, path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders(uid);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `request_failed_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function sortSavedPlaces(places: SavedPlace[]): SavedPlace[] {
  const toMillis = (value: any) => {
    if (!value) return 0;
    if (typeof value === 'string') return Date.parse(value) || 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === 'function') return value.toMillis();
    return 0;
  };
  return [...places].sort((a, b) => toMillis(b.savedAt) - toMillis(a.savedAt));
}

async function fetchUserState(uid: string): Promise<any | null> {
  const payload = await apiRequest<{ data: any | null }>(uid, '/api/user/me');
  return payload.data ?? null;
}

async function fetchSavedPlaces(uid: string): Promise<SavedPlace[]> {
  const payload = await apiRequest<{ places: SavedPlace[] }>(uid, '/api/user/me/saved-places');
  return sortSavedPlaces(payload.places || []);
}

function createPollingSubscription<T>(
  loader: () => Promise<T>,
  onData: (data: T) => void,
  onErrorValue: T,
): Unsubscribe {
  let active = true;
  let pollTimer: number | null = null;
  let hasSucceeded = false;

  const load = async () => {
    try {
      const data = await loader();
      if (!active) return;
      hasSucceeded = true;
      onData(data);
    } catch (err) {
      console.error('userData sync failed', err);
      if (!active) return;
      if (!hasSucceeded) onData(onErrorValue);
    }
  };

  void load();
  pollTimer = window.setInterval(() => { void load(); }, USER_SYNC_POLL_MS);

  return () => {
    active = false;
    if (pollTimer !== null) window.clearInterval(pollTimer);
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function listenToUserDoc(uid: string, onData: (data: any | null) => void): Unsubscribe {
  if (DEV_AUTH_BYPASS) {
    onData(null);
    return () => {};
  }
  return createPollingSubscription(() => fetchUserState(uid), onData, null);
}

export async function upsertUserProfile(uid: string, profile: Record<string, any>) {
  if (DEV_AUTH_BYPASS) return;
  await apiRequest(uid, '/api/user/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ profile: stripUndefined(profile) || {} }),
  });
}

export async function saveUserField(uid: string, key: string, value: any) {
  if (DEV_AUTH_BYPASS) return;
  const cleanedValue = key === 'entitlement'
    ? sanitizeClientEntitlementPatch(value)
    : stripUndefined(value);
  await apiRequest(uid, '/api/user/me/field', {
    method: 'PATCH',
    body: JSON.stringify({ key, value: cleanedValue }),
  });
}

export function listenToSavedPlaces(uid: string, onData: (places: SavedPlace[]) => void): Unsubscribe {
  if (DEV_AUTH_BYPASS) {
    onData([]);
    return () => {};
  }
  return createPollingSubscription(() => fetchSavedPlaces(uid), onData, []);
}

export async function upsertSavedPlace(uid: string, place: SavedPlace): Promise<void> {
  if (DEV_AUTH_BYPASS) return;
  const payload = stripUndefined(place);
  await apiRequest(uid, `/api/user/me/saved-places/${encodeURIComponent(place.placeId)}`, {
    method: 'PUT',
    body: JSON.stringify({ place: payload }),
  });
}

export async function deleteSavedPlace(uid: string, placeId: string): Promise<void> {
  if (DEV_AUTH_BYPASS) return;
  await apiRequest(uid, `/api/user/me/saved-places/${encodeURIComponent(placeId)}`, {
    method: 'DELETE',
  });
}
