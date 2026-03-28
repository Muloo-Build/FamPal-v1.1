import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase';

export type ReserveSmartInsightResponse =
  | { ok: true; used: number; limit: number; remaining: number }
  | { ok: false; reason: 'limit_reached'; used: number; limit: number; resetMonth?: string }
  | { ok: false; reason: 'rate_limited' };

export type RefundSmartInsightResponse =
  | { ok: true; used: number; limit: number; remaining?: number }
  | { ok: false; reason: 'month_changed' };

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');

async function getAuthHeaders() {
  if (!auth?.currentUser) throw new Error('auth_required');
  const token = await auth.currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function reserveSmartInsightCredit(): Promise<ReserveSmartInsightResponse> {
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true') {
    return { ok: true, used: 0, limit: -1, remaining: -1 };
  }
  const user = auth?.currentUser;
  if (!user) throw new Error('auth_required');

  const currentMonth = new Date().toISOString().slice(0, 7);
  const headers = await getAuthHeaders();
  
  const res = await fetch(`${API_BASE}/api/user/${user.uid}/ai-credits/reserve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ month: currentMonth }),
  });
  
  if (!res.ok) {
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      if (data.reason === 'limit_reached') {
        return data as ReserveSmartInsightResponse;
      }
      return { ok: false, reason: 'rate_limited' };
    }
    throw new Error('API failed');
  }
  return res.json();
}

export async function refundSmartInsightCredit(): Promise<RefundSmartInsightResponse> {
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true') {
    return { ok: true, used: 0, limit: -1 };
  }
  const user = auth?.currentUser;
  if (!user) throw new Error('auth_required');
  
  const currentMonth = new Date().toISOString().slice(0, 7);
  const headers = await getAuthHeaders();
  
  const res = await fetch(`${API_BASE}/api/user/${user.uid}/ai-credits/refund`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ month: currentMonth }),
  });
  
  if (!res.ok) throw new Error('API failed');
  return res.json();
}
