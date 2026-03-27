import { auth, db, doc, getDoc, setDoc, serverTimestamp } from './firebase';
import type { GroupPlace, Memory } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');

export interface PartnerThreadNote {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface PartnerThreadState {
  partnerLink: Record<string, any> | null;
  notes: PartnerThreadNote[];
  sharedPlaces: GroupPlace[];
  sharedMemories: Memory[];
  familyPool: Record<string, any> | null;
}

export function getPartnerThreadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

function canUseBackend(uidA?: string, uidB?: string): boolean {
  const currentUid = auth?.currentUser?.uid;
  if (!currentUid || !API_BASE) return false;
  if (!uidA || !uidB) return true;
  return currentUid === uidA || currentUid === uidB;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('auth_user_unavailable');
  }
  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `request_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function ensurePartnerThread(uidA: string, uidB: string): Promise<string> {
  if (canUseBackend(uidA, uidB)) {
    await apiRequest<PartnerThreadState>('/api/partner/thread');
    return getPartnerThreadId(uidA, uidB);
  }

  if (!db) {
    throw new Error('Firestore not initialized');
  }
  const threadId = getPartnerThreadId(uidA, uidB);
  const ref = doc(db, 'partnerThreads', threadId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      members: [uidA, uidB],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'active',
    });
  } else {
    const data = snap.data() || {};
    if (data.status === 'closed') {
      await setDoc(ref, { status: 'active', updatedAt: serverTimestamp() }, { merge: true });
    }
  }
  return threadId;
}

export async function fetchPartnerThreadState(): Promise<PartnerThreadState> {
  return apiRequest<PartnerThreadState>('/api/partner/thread');
}

export async function savePartnerThreadNote(text: string, createdByName: string): Promise<PartnerThreadNote> {
  const payload = await apiRequest<{ note: PartnerThreadNote }>('/api/partner/thread/notes', {
    method: 'POST',
    body: JSON.stringify({ text, createdByName }),
  });
  return payload.note;
}

export async function savePartnerThreadPlace(place: GroupPlace): Promise<void> {
  await apiRequest('/api/partner/thread/places/' + encodeURIComponent(place.placeId), {
    method: 'PUT',
    body: JSON.stringify({ place }),
  });
}

export async function savePartnerThreadMemory(memory: Memory): Promise<void> {
  await apiRequest('/api/partner/thread/memories/' + encodeURIComponent(memory.id), {
    method: 'PUT',
    body: JSON.stringify({ memory }),
  });
}

export async function savePartnerThreadFamilyPool(familyPool: Record<string, any>): Promise<Record<string, any>> {
  const payload = await apiRequest<{ familyPool: Record<string, any> }>('/api/partner/thread/family-pool', {
    method: 'PATCH',
    body: JSON.stringify({ familyPool }),
  });
  return payload.familyPool;
}
