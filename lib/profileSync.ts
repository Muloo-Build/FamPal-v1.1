import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { AppState, UserPreferences, SavedLocation, ExploreIntent, getDefaultEntitlement } from '../types';
import { saveUserField } from './userData';

const GUEST_PREFERENCES_KEY = 'fampals_guest_preferences';
const DEBOUNCE_MS = 1500;

let debounceTimer: NodeJS.Timeout | null = null;
let pendingUpdates: Partial<UserPreferences> = {};

export function getGuestPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(GUEST_PREFERENCES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveGuestPreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(GUEST_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    console.warn('Failed to save guest preferences to localStorage');
  }
}

export function clearGuestPreferences(): void {
  try {
    localStorage.removeItem(GUEST_PREFERENCES_KEY);
  } catch {
    // Silently fail
  }
}

export async function loadUserProfile(userId: string): Promise<Partial<AppState> | null> {
  if (!db) return null;
  
  try {
    const userDocRef = doc(db, 'users', userId);
    const snap = await getDoc(userDocRef);
    
    if (snap.exists()) {
      return snap.data() as Partial<AppState>;
    }
    return null;
  } catch (error) {
    console.error('Failed to load user profile:', error);
    return null;
  }
}

export async function saveUserProfile(userId: string, data: Partial<AppState>): Promise<boolean> {
  try {
    await Promise.all(
      Object.entries(data).map(([key, value]) => saveUserField(userId, key, value)),
    );
    return true;
  } catch (error) {
    console.error('Failed to save user profile:', error);
    return false;
  }
}

export function updatePreferenceDebounced(
  key: keyof UserPreferences, 
  value: SavedLocation | number | ExploreIntent | string | undefined,
  isGuest: boolean,
  currentPrefs: UserPreferences
): UserPreferences {
  const newPrefs: UserPreferences = { ...currentPrefs };
  
  switch (key) {
    case 'lastLocation':
      newPrefs.lastLocation = value as SavedLocation | undefined;
      break;
    case 'lastRadius':
      newPrefs.lastRadius = value as number | undefined;
      break;
    case 'lastCategory':
      newPrefs.lastCategory = value as ExploreIntent | undefined;
      break;
    case 'activeCircleId':
      newPrefs.activeCircleId = value as string | undefined;
      break;
  }
  
  if (isGuest) {
    saveGuestPreferences(newPrefs);
    return newPrefs;
  }
  
  (pendingUpdates as Record<string, unknown>)[key] = value;
  
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  debounceTimer = setTimeout(() => {
    flushPendingUpdates();
  }, DEBOUNCE_MS);
  
  return newPrefs;
}

async function flushPendingUpdates(): Promise<void> {
  const userId = auth?.currentUser?.uid;
  if (!userId || Object.keys(pendingUpdates).length === 0) {
    pendingUpdates = {};
    return;
  }
  
  try {
    await saveUserField(userId, 'userPreferences', pendingUpdates);
    pendingUpdates = {};
  } catch (error) {
    console.error('Failed to flush preference updates:', error);
  }
}

export async function syncGuestPreferencesToUser(userId: string): Promise<boolean> {
  const guestPrefs = getGuestPreferences();
  
  if (Object.keys(guestPrefs).length === 0) {
    return true;
  }
  
  try {
    const success = await saveUserProfile(userId, { userPreferences: guestPrefs });
    if (success) {
      clearGuestPreferences();
    }
    return success;
  } catch (error) {
    console.error('Failed to sync guest preferences:', error);
    return false;
  }
}

export function updateLocation(
  location: SavedLocation,
  isGuest: boolean,
  currentPrefs: UserPreferences
): UserPreferences {
  return updatePreferenceDebounced('lastLocation', location, isGuest, currentPrefs);
}

export function updateRadius(
  radius: number,
  isGuest: boolean,
  currentPrefs: UserPreferences
): UserPreferences {
  return updatePreferenceDebounced('lastRadius', radius, isGuest, currentPrefs);
}

export function updateCategory(
  category: ExploreIntent,
  isGuest: boolean,
  currentPrefs: UserPreferences
): UserPreferences {
  return updatePreferenceDebounced('lastCategory', category, isGuest, currentPrefs);
}

export function updateActiveCircle(
  circleId: string | undefined,
  isGuest: boolean,
  currentPrefs: UserPreferences
): UserPreferences {
  return updatePreferenceDebounced('activeCircleId', circleId, isGuest, currentPrefs);
}

export function flushPreferences(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  flushPendingUpdates();
}

window.addEventListener('beforeunload', () => {
  flushPreferences();
});
