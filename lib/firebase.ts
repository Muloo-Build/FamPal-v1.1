// lib/firebase.ts — Firebase replaced with Railway JWT auth
// Google Sign-In uses Google Identity Services (GSI) directly

export const isFirebaseConfigured = true;
export const firebaseConfigError = null;
export const authPersistenceReady: Promise<void> = Promise.resolve();

const TOKEN_KEY = 'fampal_auth_token';
const USER_KEY = 'fampal_auth_user';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** JWT auth stub — returns the stored token */
  getIdToken?: () => Promise<string>;
}

type AuthCallback = (user: AuthUser | null) => void;
const listeners: Set<AuthCallback> = new Set();
let currentUser: AuthUser | null = null;

function loadStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function setCurrentUser(user: AuthUser | null) {
  currentUser = user;
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
  listeners.forEach(cb => cb(user));
}

// Init from storage on load
currentUser = loadStoredUser();

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function onAuthStateChanged(_auth: any, callback: AuthCallback): () => void {
  listeners.add(callback);
  // Fire immediately with current state
  setTimeout(() => callback(currentUser), 0);
  return () => listeners.delete(callback);
}

async function exchangeToken(endpoint: string, body: Record<string, string>): Promise<AuthUser> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Auth failed' }));
    throw new Error(err.error || 'Auth failed');
  }
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  const user: AuthUser = { uid: data.uid, email: data.email, displayName: data.displayName, photoURL: data.photoURL || null };
  setCurrentUser(user);
  return user;
}

// Fetch Google Client ID from the server at runtime (works in all environments)
let _googleClientId: string | null = null;
async function getGoogleClientId(): Promise<string> {
  if (_googleClientId) return _googleClientId;
  // Fall back to build-time env var if available
  const buildTimeId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (buildTimeId) { _googleClientId = buildTimeId; return buildTimeId; }
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data.googleClientId) { _googleClientId = data.googleClientId; return data.googleClientId; }
    }
  } catch { /* ignore */ }
  return '';
}

// Renders Google's official sign-in button into a container element.
// More reliable than prompt() which can be suppressed by browsers.
export async function renderGoogleSignInButton(
  container: HTMLElement,
  onSuccess: (user: AuthUser) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const clientId = await getGoogleClientId();
  if (!clientId) {
    onError(new Error('Google sign-in is not configured. Please use email/password.'));
    return;
  }

  const g = (window as any).google;
  if (!g?.accounts?.id) {
    onError(new Error('Google Sign-In script not loaded yet. Please try again.'));
    return;
  }

  g.accounts.id.initialize({
    client_id: clientId,
    callback: async (response: any) => {
      try {
        const user = await exchangeToken('/api/auth/google', { idToken: response.credential });
        onSuccess(user);
      } catch (err: any) {
        onError(err);
      }
    },
    cancel_on_tap_outside: false,
  });

  g.accounts.id.renderButton(container, {
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    width: container.offsetWidth || 320,
  });
}

export async function signInWithGoogle(): Promise<AuthUser> {
  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(container);
    renderGoogleSignInButton(
      container,
      (user) => { document.body.removeChild(container); resolve(user); },
      (err) => { document.body.removeChild(container); reject(err); },
    );
  });
}

export async function signInWithPopup(_auth: any, _provider: any): Promise<{ user: AuthUser }> {
  const user = await signInWithGoogle();
  return { user };
}

export const googleProvider = {};
export const auth = { currentUser: null as AuthUser | null };

export async function signInWithEmailAndPassword(_auth: any, email: string, password: string): Promise<{ user: AuthUser }> {
  const user = await exchangeToken('/api/auth/login', { email, password });
  return { user };
}

export async function createUserWithEmailAndPassword(_auth: any, email: string, password: string): Promise<{ user: AuthUser }> {
  const user = await exchangeToken('/api/auth/signup', { email, password });
  return { user };
}

export async function sendPasswordResetEmail(_auth: any, email: string): Promise<void> {
  await fetch('/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function updateProfile(user: any, profile: { displayName?: string }): Promise<void> {
  const token = getStoredToken();
  if (token && profile.displayName) {
    await fetch('/api/user/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profile: { displayName: profile.displayName } }),
    });
  }
}

export async function signOut(_auth?: any): Promise<void> {
  setCurrentUser(null);
}

// Stubs for things no longer needed
export const db = null;
export const app = null;
export const storage = null;

// Timestamp interface mirroring the Firestore shape used across the app
export interface Timestamp {
  toDate(): Date;
  toMillis(): number;
}
export const Timestamp = {
  now: (): Timestamp => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
};
export const doc = (..._args: any[]) => null;
export const onSnapshot = (..._args: any[]) => () => {};
export const setDoc = async (..._args: any[]) => {};
export const getDoc = async (..._args: any[]) => ({ exists: () => false, data: () => null, id: '' as string });
export const getDocs = async (..._args: any[]) => ({ docs: [] as any[], empty: true, size: 0 });
export const collection = (..._args: any[]) => null;
export const collectionGroup = (..._args: any[]) => null;
export const query = (...args: any[]) => args[0];
export const where = (..._args: any[]) => null;
export const orderBy = (..._args: any[]) => null;
export const startAt = (..._args: any[]) => null;
export const endAt = (..._args: any[]) => null;
export const limit = (..._args: any[]) => null;
export const addDoc = async (..._args: any[]) => ({} as any);
export const increment = (n: number) => n;
export const FieldPath = {};
export const documentId = (..._args: any[]) => null;
export const deleteDoc = async (..._args: any[]) => {};
export const deleteField = (..._args: any[]) => null;
export const updateDoc = async (..._args: any[]) => {};
export const writeBatch = (..._args: any[]) => ({
  set: (..._a: any[]) => {},
  update: (..._a: any[]) => {},
  delete: (..._a: any[]) => {},
  commit: async () => {},
});
export const runTransaction = async (_db: any, fn: any) => fn({});
export const serverTimestamp = () => new Date().toISOString();
export const ref = (..._args: any[]) => null;
export const uploadBytes = async (..._args: any[]) => ({} as any);
export const uploadBytesResumable = (..._args: any[]) => ({
  on: (..._a: any[]) => {},
  cancel: () => {},
  snapshot: { bytesTransferred: 0, totalBytes: 0, state: 'paused' as string, ref: null as any },
});
export const getDownloadURL = async (..._args: any[]) => '';
export const signInWithRedirect = async (..._args: any[]) => {};
export const getRedirectResult = async (..._args: any[]) => null;
export const reauthenticateWithRedirect = async (..._args: any[]) => {};
