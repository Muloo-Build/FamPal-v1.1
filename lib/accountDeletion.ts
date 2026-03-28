import {
  auth,
  db,
  collection,
  query,
  where,
  limit,
  getDocs,
  writeBatch,
  doc,
  deleteDoc,
} from './firebase';
import type { User } from 'firebase/auth';

const PAGE_SIZE = 100;

export function hasRecentLogin(user: User, maxAgeMs: number = 5 * 60 * 1000): boolean {
  const lastSignIn = user.metadata?.lastSignInTime;
  if (!lastSignIn) return false;
  const lastSignInMs = new Date(lastSignIn).getTime();
  if (Number.isNaN(lastSignInMs)) return false;
  return Date.now() - lastSignInMs <= maxAgeMs;
}

async function deleteQueryInBatches(baseQuery: any): Promise<number> {
  if (!db) return 0;
  let totalDeleted = 0;
  while (true) {
    const snap = await getDocs(query(baseQuery, limit(PAGE_SIZE)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    totalDeleted += snap.size;
    if (snap.size < PAGE_SIZE) break;
  }
  return totalDeleted;
}

async function deleteCircleWithSubcollections(circleId: string): Promise<void> {
  if (!db) return;
  const subcollections = ['members', 'places', 'memories', 'placeComments'];
  for (const subcol of subcollections) {
    await deleteQueryInBatches(collection(db, 'circles', circleId, subcol));
  }
  await deleteDoc(doc(db, 'circles', circleId));
}

export async function deleteUserOwnedFirestoreData(
  uid: string,
  options?: { onLog?: (message: string, details?: unknown) => void }
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  const log = options?.onLog || (() => {});

  log('Deleting users/{uid}/savedPlaces');
  await deleteQueryInBatches(collection(db, 'users', uid, 'savedPlaces'));

  // Intentionally avoiding generic collectionGroup deletion for "places" (and related broad groups)
  // to reduce accidental deletion risk against non-user-owned/global data.
  // TODO: If needed, add explicit, path-scoped cleanup for user-authored docs outside owned circles.

  log('Deleting circles created by user');
  while (true) {
    const ownedCirclesSnap = await getDocs(query(collection(db, 'circles'), where('createdBy', '==', uid), limit(PAGE_SIZE)));
    if (ownedCirclesSnap.empty) break;
    for (const circleDoc of ownedCirclesSnap.docs) {
      await deleteCircleWithSubcollections(circleDoc.id);
    }
    if (ownedCirclesSnap.size < PAGE_SIZE) break;
  }

  // TODO: Add explicit partner thread cleanup with path-scoped queries if required.

  log('Deleting optional per-user root documents');
  await deleteDoc(doc(db, 'userProfiles', uid)).catch(() => {});
  await deleteDoc(doc(db, 'preferences', uid)).catch(() => {});

  log('Deleting users/{uid}');
  await deleteDoc(doc(db, 'users', uid));
}

export function clearLocalAppState(): void {
  const clear = (storage: Storage | undefined) => {
    if (!storage) return;
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith('fampal_')) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => storage.removeItem(key));
  };
  try {
    clear(window.localStorage);
    clear(window.sessionStorage);
  } catch {
    // Ignore local/session storage errors.
  }
}

export function isDeleteBlockedByBypass(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true';
}

export function getCurrentAuthUser() {
  return auth?.currentUser || null;
}
