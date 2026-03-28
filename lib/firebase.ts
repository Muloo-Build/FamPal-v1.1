import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from "firebase/auth";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  addDoc,
  increment,
  FieldPath,
  documentId,
  deleteDoc,
  deleteField,
  getDocs,
  getDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const normalizeStorageBucket = (bucket: string | undefined, projectId: string | undefined): string | undefined => {
  if (!bucket) return bucket;
  const cleaned = bucket
    .replace(/^gs:\/\//, '')
    .replace(/^https?:\/\/storage\.googleapis\.com\/v0\/b\//, '')
    .replace(/\/.*$/, '');

  if (cleaned.endsWith('.appspot.com') && projectId) {
    return `${projectId}.firebasestorage.app`;
  }
  return cleaned;
};

const resolvedStorageBucket = normalizeStorageBucket(firebaseConfig.storageBucket, firebaseConfig.projectId);
if (resolvedStorageBucket) {
  firebaseConfig.storageBucket = resolvedStorageBucket;
}

console.log('[FamPal] Firebase config check:', {
  hasApiKey: !!firebaseConfig.apiKey,
  hasAuthDomain: !!firebaseConfig.authDomain,
  hasProjectId: !!firebaseConfig.projectId,
  projectId: firebaseConfig.projectId,
  hasStorageBucket: !!firebaseConfig.storageBucket,
  hasMessagingSenderId: !!firebaseConfig.messagingSenderId,
  hasAppId: !!firebaseConfig.appId
});

const isConfigValid = firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain;

let app = null;
let auth: ReturnType<typeof getAuth> | null = null;
let db: ReturnType<typeof getFirestore> | null = null;
let storage: ReturnType<typeof getStorage> | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let authPersistenceReady: Promise<void> = Promise.resolve();

if (isConfigValid) {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
  storage = firebaseConfig.storageBucket
    ? getStorage(app, `gs://${firebaseConfig.storageBucket}`)
    : getStorage(app);
  googleProvider = new GoogleAuthProvider();

  authPersistenceReady = setPersistence(auth, browserLocalPersistence)
    .catch((localErr) => {
      if (import.meta.env.DEV) {
        console.warn("Auth local persistence failed, falling back to session persistence", localErr);
      }
      return setPersistence(auth!, browserSessionPersistence);
    })
    .catch((sessionErr) => {
      if (import.meta.env.DEV) {
        console.warn("Auth session persistence failed", sessionErr);
      }
    })
    .then(() => undefined);
}

export const isFirebaseConfigured = isConfigValid && !!app;
export const firebaseConfigError = !isConfigValid 
  ? "Firebase is not configured. Please add Firebase secrets (VITE_FIREBASE_API_KEY, etc.) in the Secrets tab."
  : null;

export {
  app,
  auth,
  db,
  storage,
  googleProvider,
  authPersistenceReady,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  doc,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  addDoc,
  increment,
  FieldPath,
  documentId,
  deleteDoc,
  deleteField,
  updateDoc,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
};
