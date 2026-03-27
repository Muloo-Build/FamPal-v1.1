import {
  auth,
  db,
  collection,
  collectionGroup,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  deleteDoc,
} from './firebase';

export interface CircleDoc {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  joinCode: string;
  isPartnerCircle?: boolean;
}

export interface CircleMemberDoc {
  uid: string;
  role: 'owner' | 'member';
  displayName?: string;
  email?: string;
  joinedAt: string;
}

export interface CirclePlaceDoc {
  placeId: string;
  savedByUid: string;
  savedByName: string;
  savedAt: string;
  note?: string;
  placeSummary: {
    placeId: string;
    name: string;
    imageUrl?: string;
    type?: string;
    mapsUrl?: string;
  };
}

export interface CircleCommentDoc {
  id: string;
  placeId: string;
  uid: string;
  text: string;
  createdAt: string;
  displayName?: string;
}

export interface CircleMemoryDoc {
  id: string;
  memoryId: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  memorySnapshot: {
    caption: string;
    placeId?: string;
    placeName: string;
    photoUrl?: string;
    photoUrls?: string[];
    photoThumbUrl?: string;
    photoThumbUrls?: string[];
    date: string;
  };
}

type Unsubscribe = () => void;

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
const POLL_MS = 10000;

function stripUndefined<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === 'object') {
    const cleaned: Record<string, any> = {};
    Object.entries(value as Record<string, any>).forEach(([key, val]) => {
      const nextVal = stripUndefined(val);
      if (nextVal !== undefined) {
        cleaned[key] = nextVal;
      }
    });
    return cleaned as T;
  }
  return value;
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function shouldUseBackend(): boolean {
  return !!API_BASE && !!auth?.currentUser;
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

function createPollingSubscription<T>(loader: () => Promise<T>, onData: (data: T) => void, onErrorValue: T): Unsubscribe {
  let active = true;
  let intervalId: number | null = null;

  const load = async () => {
    try {
      const data = await loader();
      if (!active) return;
      onData(data);
    } catch (err) {
      console.error('circle sync failed', err);
      if (!active) return;
      onData(onErrorValue);
    }
  };

  void load();
  intervalId = window.setInterval(() => {
    void load();
  }, POLL_MS);

  return () => {
    active = false;
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
  };
}

export async function createCircle(name: string, user: { uid: string; displayName?: string | null; email?: string | null }) {
  if (shouldUseBackend()) {
    const payload = await apiRequest<{ circle: CircleDoc }>('/api/circles', {
      method: 'POST',
      body: JSON.stringify({ name, user }),
    });
    return payload.circle;
  }

  if (!db) throw new Error('Firestore not initialized');
  const circleRef = doc(collection(db, 'circles'));
  const joinCode = generateJoinCode();
  const createdAt = new Date().toISOString();
  await setDoc(circleRef, stripUndefined({
    name,
    createdBy: user.uid,
    createdAt,
    joinCode,
  }));
  await setDoc(doc(db, 'circles', circleRef.id, 'members', user.uid), stripUndefined({
    uid: user.uid,
    role: 'owner',
    displayName: user.displayName || undefined,
    email: user.email || undefined,
    joinedAt: createdAt,
  }));
  return {
    id: circleRef.id,
    name,
    createdBy: user.uid,
    createdAt,
    joinCode,
  } as CircleDoc;
}

export async function createPartnerCircle(
  name: string,
  user: { uid: string; displayName?: string | null; email?: string | null },
  partner: { uid: string; displayName?: string | null; email?: string | null }
) {
  if (shouldUseBackend()) {
    const payload = await apiRequest<{ circle: CircleDoc }>('/api/circles', {
      method: 'POST',
      body: JSON.stringify({ name, user, isPartnerCircle: true, partner }),
    });
    return payload.circle;
  }

  if (!db) throw new Error('Firestore not initialized');
  const circleRef = doc(collection(db, 'circles'));
  const joinCode = generateJoinCode();
  const createdAt = new Date().toISOString();
  await setDoc(circleRef, stripUndefined({
    name,
    createdBy: user.uid,
    createdAt,
    joinCode,
    isPartnerCircle: true,
  }));
  await setDoc(doc(db, 'circles', circleRef.id, 'members', user.uid), stripUndefined({
    uid: user.uid,
    role: 'owner',
    displayName: user.displayName || undefined,
    email: user.email || undefined,
    joinedAt: createdAt,
  }));
  await setDoc(doc(db, 'circles', circleRef.id, 'members', partner.uid), stripUndefined({
    uid: partner.uid,
    role: 'member',
    displayName: partner.displayName || undefined,
    email: partner.email || undefined,
    joinedAt: createdAt,
  }));
  return {
    id: circleRef.id,
    name,
    createdBy: user.uid,
    createdAt,
    joinCode,
    isPartnerCircle: true,
  } as CircleDoc;
}

export async function joinCircleByCode(code: string, user: { uid: string; displayName?: string | null; email?: string | null }) {
  if (shouldUseBackend()) {
    const payload = await apiRequest<{ circle: CircleDoc }>('/api/circles/join', {
      method: 'POST',
      body: JSON.stringify({ code, user }),
    });
    return payload.circle;
  }

  if (!db) throw new Error('Firestore not initialized');
  const q = query(collection(db, 'circles'), where('joinCode', '==', code));
  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error('No circle found for that code.');
  }
  const circleDoc = snap.docs[0];
  const circleData = circleDoc.data();
  await setDoc(doc(db, 'circles', circleDoc.id, 'members', user.uid), stripUndefined({
    uid: user.uid,
    role: 'member',
    displayName: user.displayName || undefined,
    email: user.email || undefined,
    joinedAt: new Date().toISOString(),
  }), { merge: true });

  return {
    id: circleDoc.id,
    name: circleData.name,
    createdBy: circleData.createdBy,
    createdAt: circleData.createdAt,
    joinCode: circleData.joinCode,
    isPartnerCircle: circleData.isPartnerCircle || false,
  } as CircleDoc;
}

export function listenToUserCircles(uid: string, onData: (circles: CircleDoc[]) => void): Unsubscribe {
  if (shouldUseBackend() && typeof window !== 'undefined') {
    return createPollingSubscription(
      async () => (await apiRequest<{ circles: CircleDoc[] }>('/api/circles')).circles || [],
      onData,
      [],
    );
  }

  if (!db) {
    onData([]);
    return () => {};
  }

  const membersQuery = query(collectionGroup(db, 'members'), where('uid', '==', uid));
  const unsub = onSnapshot(membersQuery, async (snap) => {
    if (snap.docs.length === 0) {
      onData([]);
      return;
    }
    const circleDocs = await Promise.all(
      snap.docs.map(async (memberDoc) => {
        const circleRef = memberDoc.ref.parent.parent;
        if (!circleRef) return null;
        const circleSnap = await getDoc(circleRef);
        if (!circleSnap.exists()) return null;
        const data = circleSnap.data();
        return {
          id: circleSnap.id,
          name: data.name,
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          joinCode: data.joinCode,
          isPartnerCircle: data.isPartnerCircle || false,
        } as CircleDoc;
      }),
    );
    onData(circleDocs.filter(Boolean) as CircleDoc[]);
  }, () => onData([]));

  return () => unsub();
}

export function listenToCircleMembers(circleId: string, onData: (members: CircleMemberDoc[]) => void): Unsubscribe {
  if (shouldUseBackend() && typeof window !== 'undefined') {
    return createPollingSubscription(
      async () => (await apiRequest<{ members: CircleMemberDoc[] }>(`/api/circles/${encodeURIComponent(circleId)}/members`)).members || [],
      onData,
      [],
    );
  }

  if (!db) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'circles', circleId, 'members');
  const unsub = onSnapshot(ref, (snap) => {
    const members = snap.docs.map((docSnap) => docSnap.data() as CircleMemberDoc);
    onData(members);
  });
  return () => unsub();
}

export function listenToCirclePlaces(circleId: string, onData: (places: CirclePlaceDoc[]) => void): Unsubscribe {
  if (shouldUseBackend() && typeof window !== 'undefined') {
    return createPollingSubscription(
      async () => (await apiRequest<{ places: CirclePlaceDoc[] }>(`/api/circles/${encodeURIComponent(circleId)}/places`)).places || [],
      onData,
      [],
    );
  }

  if (!db) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'circles', circleId, 'places');
  const unsub = onSnapshot(ref, (snap) => {
    const places = snap.docs.map((docSnap) => docSnap.data() as CirclePlaceDoc);
    onData(places);
  });
  return () => unsub();
}

export async function saveCirclePlace(circleId: string, place: CirclePlaceDoc) {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}/places/${encodeURIComponent(place.placeId)}`, {
      method: 'PUT',
      body: JSON.stringify({ place }),
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  await setDoc(doc(db, 'circles', circleId, 'places', place.placeId), stripUndefined(place), { merge: true });
}

export async function removeCirclePlace(circleId: string, placeId: string) {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}/places/${encodeURIComponent(placeId)}`, {
      method: 'DELETE',
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  await deleteDoc(doc(db, 'circles', circleId, 'places', placeId));
}

export function listenToCircleComments(circleId: string, placeId: string, onData: (comments: CircleCommentDoc[]) => void): Unsubscribe {
  if (shouldUseBackend() && typeof window !== 'undefined') {
    return createPollingSubscription(
      async () => (await apiRequest<{ comments: CircleCommentDoc[] }>(`/api/circles/${encodeURIComponent(circleId)}/comments?placeId=${encodeURIComponent(placeId)}`)).comments || [],
      onData,
      [],
    );
  }

  if (!db) {
    onData([]);
    return () => {};
  }
  const q = query(collection(db, 'circles', circleId, 'placeComments'), where('placeId', '==', placeId));
  const unsub = onSnapshot(q, (snap) => {
    const comments = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<CircleCommentDoc, 'id'>),
    }));
    comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    onData(comments);
  });
  return () => unsub();
}

export async function addCircleComment(circleId: string, placeId: string, comment: Omit<CircleCommentDoc, 'id' | 'placeId'>) {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ placeId, comment }),
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  await addDoc(collection(db, 'circles', circleId, 'placeComments'), stripUndefined({ ...comment, placeId }));
}

export function listenToCircleMemories(circleId: string, onData: (memories: CircleMemoryDoc[]) => void): Unsubscribe {
  if (shouldUseBackend() && typeof window !== 'undefined') {
    return createPollingSubscription(
      async () => (await apiRequest<{ memories: CircleMemoryDoc[] }>(`/api/circles/${encodeURIComponent(circleId)}/memories`)).memories || [],
      onData,
      [],
    );
  }

  if (!db) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, 'circles', circleId, 'memories');
  const unsub = onSnapshot(ref, (snap) => {
    const memories = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<CircleMemoryDoc, 'id'>),
    }));
    memories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    onData(memories);
  });
  return () => unsub();
}

export async function addCircleMemory(circleId: string, memory: CircleMemoryDoc) {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}/memories/${encodeURIComponent(memory.memoryId)}`, {
      method: 'PUT',
      body: JSON.stringify({ memory }),
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  await setDoc(doc(db, 'circles', circleId, 'memories', memory.memoryId), stripUndefined(memory), { merge: true });
}

export async function deleteCircle(circleId: string, userId: string): Promise<void> {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}`, {
      method: 'DELETE',
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  const circleRef = doc(db, 'circles', circleId);
  const circleSnap = await getDoc(circleRef);
  if (!circleSnap.exists()) {
    throw new Error('Circle not found');
  }
  const circleData = circleSnap.data();
  if (circleData.createdBy !== userId) {
    throw new Error('Only the circle owner can delete it');
  }
  for (const subcol of ['members', 'places', 'memories', 'placeComments']) {
    const subcolSnap = await getDocs(collection(db, 'circles', circleId, subcol));
    await Promise.all(subcolSnap.docs.map(docSnap => deleteDoc(docSnap.ref)));
  }
  await deleteDoc(circleRef);
}

export async function leaveCircle(circleId: string, userId: string): Promise<void> {
  if (shouldUseBackend()) {
    await apiRequest(`/api/circles/${encodeURIComponent(circleId)}/leave`, {
      method: 'POST',
    });
    return;
  }

  if (!db) throw new Error('Firestore not initialized');
  const circleRef = doc(db, 'circles', circleId);
  const circleSnap = await getDoc(circleRef);
  if (!circleSnap.exists()) {
    throw new Error('Circle not found');
  }
  const circleData = circleSnap.data();
  if (circleData.createdBy === userId) {
    throw new Error('Owner cannot leave the circle. Delete it instead.');
  }
  await deleteDoc(doc(db, 'circles', circleId, 'members', userId));
}
