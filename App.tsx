
// FamPal v1.1 - Family Activity Discovery App
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  auth,
  googleProvider,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  isFirebaseConfigured,
  firebaseConfigError,
  authPersistenceReady,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
} from './lib/firebase';
import { listenToUserDoc, upsertUserProfile, saveUserField, listenToSavedPlaces, upsertSavedPlace } from './lib/userData';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

import Profile from './components/Profile';
import Onboarding from './components/Onboarding';
import { AppState, User, getDefaultEntitlement, UserPreferences, SavedPlace, Preferences, Child, Pet, PartnerLink, ProfileInfo } from './types';
import { getGuestPreferences, syncGuestPreferencesToUser } from './lib/profileSync';
import type { User as FirebaseUser } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { shouldResetMonthlyAI, getNextResetDate, getCurrentUsageMonth } from './lib/entitlements';
import { joinCircleByCode } from './lib/circles';
import { buildAccessContext, type AppAccessContext } from './lib/access';
import { syncPlayEntitlementWithServer } from './lib/playBilling';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const AUTH_REDIRECT_PENDING_KEY = 'fampal_auth_redirect_pending';
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED !== 'false';
const BILLING_PROVIDER = (import.meta.env.VITE_BILLING_PROVIDER || 'play').toLowerCase();
const AUTH_DEBUG = import.meta.env.VITE_AUTH_DEBUG === 'true';

const authDebugLog = (message: string, payload?: Record<string, unknown>) => {
  if (!AUTH_DEBUG) return;
  if (payload) {
    console.log(`[FamPal Auth] ${message}`, payload);
    return;
  }
  console.log(`[FamPal Auth] ${message}`);
};

// Convert Firebase Auth User to plain serializable object
const serializeUser = (firebaseUser: FirebaseUser): User => ({
  uid: firebaseUser.uid,
  email: firebaseUser.email,
  displayName: firebaseUser.displayName,
  photoURL: firebaseUser.photoURL,
});

const summarizeAuthUser = (userAuth: FirebaseUser | null) => {
  if (!userAuth) {
    return { isNull: true };
  }
  return {
    isNull: false,
    uid: userAuth.uid,
    email: userAuth.email,
    providers: (userAuth.providerData || []).map((provider) => provider.providerId),
  };
};

// Returns a state object with all arrays guaranteed to be non-null
const getInitialState = (user: User | null, guestPrefs?: UserPreferences): AppState => ({
  isAuthenticated: !!user,
  user,
  profileInfo: undefined,
  favorites: [],
  favoriteDetails: {},
  savedPlaces: [],
  onboardingCompletedAt: undefined,
  profileCompletionRequired: false,
  familyPool: undefined,
  visited: [],
  visitedPlaces: [],
  reviews: [],
  memories: [],
  children: [],
  pets: [],
  spouseName: '',
  linkedEmail: '',
  accessibilityNeeds: {
    usesWheelchair: false,
    needsStepFree: false,
    needsAccessibleToilet: false,
    prefersPavedPaths: false,
    usesPushchair: false,
  },
  groups: [],
  friendCircles: [],
  entitlement: getDefaultEntitlement(),
  aiRequestsUsed: 0,
  userPreferences: guestPrefs || {},
  partnerSharedPlaces: [],
});

const App: React.FC = () => {
  const authBypassEnabled = import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true';
  const mockBypassUser: User = {
    uid: 'dev-bypass-user',
    email: 'dev-bypass@local.fampal',
    displayName: 'Dev Bypass User',
    photoURL: null,
  };
  const bypassInitializedRef = useRef(false);
  const [state, setState] = useState<AppState>(() => getInitialState(null));
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState('login');
  const [redirectChecked, setRedirectChecked] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [pendingJoinCircleId, setPendingJoinCircleId] = useState<string | null>(null);
  const [dashboardTab, setDashboardTab] = useState<'explore' | 'favorites' | 'activity' | 'memories' | 'circles' | 'partner'>('explore');
  const [useNetflixLayout, setUseNetflixLayout] = useState(() => {
    try { return localStorage.getItem('fampal_netflix_layout') === 'true'; } catch { return false; }
  });
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem('fampal_dark_mode');
      if (stored !== null) return stored === 'true';
      return false;
    } catch { return false; }
  });
  const accessContext: AppAccessContext = buildAccessContext({
    isGuest,
    user: state.user,
    entitlement: state.entitlement,
    isAuthBypass: authBypassEnabled,
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);
  const [savedPlacesLoaded, setSavedPlacesLoaded] = useState(false);
  const legacyFavoritesRef = useRef<string[]>([]);
  const savedPlacesMigratedAtRef = useRef<Timestamp | null>(null);
  const migrationAttemptedRef = useRef(false);
  const redirectHandledRef = useRef(false);
  const aiResetAttemptedRef = useRef<string | null>(null);
  const playSyncAttemptedRef = useRef<string | null>(null);
  const lastAuthUidRef = useRef<string | null>(null);
  const joinInFlightRef = useRef(false);
  const lastJoinCodeRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const PENDING_JOIN_KEY = 'fampal_pending_join_code';

  type OnboardingResult = {
    profileInfo?: ProfileInfo | null;
    preferences?: Preferences | null;
    children?: Child[] | null;
    pets?: Pet[] | null;
    userPreferences?: UserPreferences | null;
    partnerLink?: PartnerLink | null;
    skipped: boolean;
  };

  const handleSignIn = useCallback(async () => {
    if (authBypassEnabled) {
      setError(null);
      setIsGuest(false);
      setNeedsOnboarding(false);
      setOnboardingChecked(true);
      setState(prev => ({
        ...getInitialState(mockBypassUser),
        userPreferences: prev.userPreferences || {},
        isAuthenticated: true,
        user: mockBypassUser,
      }));
      setView('dashboard');
      return;
    }
    if (!isFirebaseConfigured || !auth || !googleProvider) {
      setError(firebaseConfigError || "Firebase is not configured properly.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authPersistenceReady;
      authDebugLog('Google sign-in start', { flow: 'redirect' });
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, '1');
      }
      await signInWithRedirect(auth, googleProvider);
      return;
    } catch (redirectErr: any) {
      authDebugLog('Redirect sign-in failed', { code: redirectErr?.code, message: redirectErr?.message });
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
      }
      if (redirectErr?.code === 'auth/cancelled-popup-request' || redirectErr?.code === 'auth/redirect-cancelled-by-user') {
        setError(null);
        setLoading(false);
        return;
      }
      if (redirectErr?.code === 'auth/unauthorized-domain') {
        setError("This domain is not authorized for Google Sign-In. Please add it to Firebase Console -> Authentication -> Settings -> Authorized domains.");
        setLoading(false);
        return;
      }
      setError(`Login failed: ${redirectErr?.message || 'Unknown error'}`);
      setLoading(false);
    }
  }, [authBypassEnabled]);

  const handleEmailSignIn = useCallback(async (email: string, password: string) => {
    if (!isFirebaseConfigured || !auth) {
      setError(firebaseConfigError || "Firebase is not configured properly.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setLoading(false);
      const code = err.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid email or password. Please try again.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/user-disabled') {
        setError('This account has been disabled. Please contact support.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else if (code === 'auth/network-request-failed') {
        setError('Network error. Please check your connection and try again.');
      } else if (code === 'auth/operation-not-allowed') {
        setError('Email sign-in is not enabled. Please use Google Sign-In.');
      } else {
        setError(err.message || 'Sign in failed.');
      }
    }
  }, []);

  const handleEmailSignUp = useCallback(async (email: string, password: string, displayName: string) => {
    if (!isFirebaseConfigured || !auth) {
      setError(firebaseConfigError || "Firebase is not configured properly.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(result.user, { displayName });
      }
    } catch (err: any) {
      setLoading(false);
      const code = err.code || '';
      if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try signing in instead.');
      } else if (code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/user-disabled') {
        setError('This account has been disabled. Please contact support.');
      } else if (code === 'auth/operation-not-allowed') {
        setError('Email sign-up is not enabled. Please use Google Sign-In.');
      } else if (code === 'auth/network-request-failed') {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(err.message || 'Sign up failed.');
      }
    }
  }, []);

  const handleForgotPassword = useCallback(async (email: string) => {
    if (!isFirebaseConfigured || !auth) {
      setError(firebaseConfigError || "Firebase is not configured properly.");
      return;
    }
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setError(null);
      return true;
    } catch (err: any) {
      const code = err.code || '';
      if (code === 'auth/user-not-found') {
        setError('No account found with this email.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/network-request-failed') {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(err.message || 'Failed to send reset email.');
      }
      return false;
    }
  }, []);

  const handleGuestLogin = () => {
    setIsGuest(true);
    setSavedPlacesLoaded(false);
    legacyFavoritesRef.current = [];
    savedPlacesMigratedAtRef.current = null;
    migrationAttemptedRef.current = false;
    const guestPrefs = getGuestPreferences();
    setState(getInitialState(null, guestPrefs));
    setView('dashboard');
  };

  const handleSignOut = useCallback(async () => {
    setError(null);
    if (isGuest) {
      setIsGuest(false);
      setSavedPlacesLoaded(false);
      legacyFavoritesRef.current = [];
      savedPlacesMigratedAtRef.current = null;
      migrationAttemptedRef.current = false;
      aiResetAttemptedRef.current = null;
      lastAuthUidRef.current = null;
      setPendingJoinCircleId(null);
      setNeedsOnboarding(false);
      setState(getInitialState(null));
      setView('login');
      return;
    }
    try {
      await firebaseSignOut(auth);
      setState(getInitialState(null));
      setNeedsOnboarding(false);
      setView('login');
    } catch (error: any) {
      console.error('Sign out error', error);
      setError(`Sign out failed: ${error.message}`);
    }
  }, [isGuest]);

  const handleUpdateState = useCallback((key: keyof AppState, value: any) => {
    setState(prev => {
      const newState = { ...prev, [key]: value };
      
      // Save to Firestore if user is logged in (not guest)
      // Use auth.currentUser for more reliable UID access
      const uid = auth?.currentUser?.uid || prev.user?.uid;
      if (accessContext.canSyncCloud && uid) {
        // Centralised save via userData service
        if (key !== 'savedPlaces' && key !== 'partnerSharedPlaces' && key !== 'familyPool') {
          saveUserField(uid, key as string, value).catch(err => {
            console.error('Failed to save to Firestore:', err);
          });
        }
      }
      
      return newState;
    });
  }, [accessContext.canSyncCloud]);
  

  useEffect(() => {
    if (authBypassEnabled) {
      if (bypassInitializedRef.current) return;
      bypassInitializedRef.current = true;
      setIsGuest(false);
      setSavedPlacesLoaded(false);
      legacyFavoritesRef.current = [];
      savedPlacesMigratedAtRef.current = null;
      migrationAttemptedRef.current = true;
      aiResetAttemptedRef.current = null;
      lastAuthUidRef.current = mockBypassUser.uid;
      setNeedsOnboarding(false);
      setOnboardingChecked(true);
      setRedirectChecked(true);
      setAuthChecked(true);
      setPendingJoinCircleId(null);
      setState(prev => ({
        ...getInitialState(mockBypassUser),
        userPreferences: prev.userPreferences || {},
        isAuthenticated: true,
        user: mockBypassUser,
      }));
      setView('dashboard');
      setLoading(false);
      return;
    }
    if (isGuest) {
      setRedirectChecked(true);
      setAuthChecked(true);
      setLoading(false);
      return;
    }

    if (!isFirebaseConfigured || !auth) {
      setAuthChecked(true);
      setLoading(false);
      return;
    }

    let unsubProfile: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, (userAuth) => {
      setAuthChecked(true);
      authDebugLog('onAuthStateChanged fired', summarizeAuthUser(userAuth));
      console.time('auth:resolved');
      if (userAuth) {
        if (lastAuthUidRef.current !== userAuth.uid) {
          aiResetAttemptedRef.current = null;
          lastAuthUidRef.current = userAuth.uid;
        }
        const serializedUser = serializeUser(userAuth);
        console.log('[FamPal] User authenticated:', userAuth.email);
        setState(prev => ({ ...prev, isAuthenticated: true, user: serializedUser }));
        setView((prev) => (prev === 'login' ? 'dashboard' : prev));
        authDebugLog('Auth user present, moving out of login state');
        // Don't set view here - wait for Firestore to check onboarding status first

        // Safety timeout to prevent stuck loading state if Firestore fails
        const loadingTimeout = setTimeout(() => {
          if (loading) {
            console.warn('[FamPal] Firestore timeout - forcing load');
            setLoading(false);
            setOnboardingChecked(true);
          }
        }, 8000);

        // Upsert profile (non-blocking) and start listening for data
        upsertUserProfile(userAuth.uid, serializedUser).catch(err => console.error(err));

        // Listen to user doc and merge data when available
        if (unsubProfile) {
          unsubProfile();
        }
        unsubProfile = listenToUserDoc(userAuth.uid, (dbState) => {
          clearTimeout(loadingTimeout);
          console.timeEnd('auth:resolved');
          const initialState = getInitialState(serializedUser);
          if (dbState) {
            const onboardingCompleted = !!dbState.onboardingCompletedAt || dbState.onboardingCompleted === true;
            authDebugLog('User doc loaded', {
              onboardingCompleted,
              hasUserDoc: true,
              dbKeys: Object.keys(dbState || {}),
            });
            setNeedsOnboarding(!onboardingCompleted);
            setOnboardingChecked(true);
            legacyFavoritesRef.current = Array.isArray(dbState.favorites) ? dbState.favorites : [];
            savedPlacesMigratedAtRef.current = dbState.savedPlacesMigratedAt || null;
            const loadedEntitlement = {
              ...getDefaultEntitlement(),
              ...(dbState.entitlement || {}),
            };
            const guestPrefs = getGuestPreferences();
            const hasGuestPrefs = Object.keys(guestPrefs).length > 0;
            if (hasGuestPrefs && !dbState.userPreferences) {
              syncGuestPreferencesToUser(userAuth.uid);
            }
            const { isPro: _ignoredIsPro, ...restDbState } = dbState;
            const resetKey = `${userAuth.uid}:${loadedEntitlement.usage_reset_month || loadedEntitlement.ai_requests_reset_date || 'none'}`;
            if (shouldResetMonthlyAI(loadedEntitlement) && aiResetAttemptedRef.current !== resetKey) {
              aiResetAttemptedRef.current = resetKey;
              const nextResetDate = getNextResetDate();
              const currentUsageMonth = getCurrentUsageMonth();
              saveUserField(userAuth.uid, 'entitlement', {
                ...loadedEntitlement,
                gemini_credits_used: 0,
                usage_reset_month: currentUsageMonth,
                ai_requests_this_month: 0,
                ai_requests_reset_date: nextResetDate,
              }).catch(err => console.warn('Failed to reset AI usage.', err));
            }
            setState(prev => {
              const savedPlaces = prev.savedPlaces || [];
              const favoritesFromSaved = savedPlaces.map(place => place.placeId);
              const legacyFavorites = Array.isArray(dbState.favorites) ? dbState.favorites : [];
              const partnerSharedPlaces = prev.partnerSharedPlaces || [];
              const familyPool = prev.familyPool;
              return {
                ...initialState,
                user: serializedUser,
                ...restDbState,
                favorites: favoritesFromSaved.length > 0 ? favoritesFromSaved : legacyFavorites,
                favoriteDetails: dbState.favoriteDetails || {},
                savedPlaces,
                partnerSharedPlaces,
                familyPool,
                visited: dbState.visited || [],
                visitedPlaces: dbState.visitedPlaces || [],
                reviews: dbState.reviews || [],
                memories: (() => {
                  const mems = dbState.memories || [];
                  if (mems.length > 0) {
                    console.log('[FamPal] Loaded memories from Firestore:', mems.length, 'first memory photos:', {
                      photoUrl: mems[0]?.photoUrl,
                      photoUrls: mems[0]?.photoUrls,
                      photoThumbUrl: mems[0]?.photoThumbUrl,
                      photoThumbUrls: mems[0]?.photoThumbUrls,
                    });
                  }
                  return mems;
                })(),
                children: dbState.children || [],
                groups: dbState.groups || [],
                friendCircles: dbState.friendCircles || [],
                entitlement: loadedEntitlement,
                userPreferences: dbState.userPreferences || guestPrefs || {},
                partnerLink: dbState.partnerLink || undefined,
                spouseName: dbState.spouseName || '',
                linkedEmail: dbState.linkedEmail || '',
                onboardingCompletedAt: dbState.onboardingCompletedAt,
                profileCompletionRequired: dbState.profileCompletionRequired || false,
              };
            });
            setLoading(false);
            if (!onboardingCompleted) {
              authDebugLog('Routing to onboarding', { reason: 'onboarding_incomplete' });
              setView('onboarding');
            } else {
              authDebugLog('Routing to dashboard', { reason: 'onboarding_complete' });
              setView((prev) => (prev === 'login' || prev === 'onboarding') ? 'dashboard' : prev);
            }
          } else {
            authDebugLog('User doc missing, defaulting to onboarding and creating profile doc');
            legacyFavoritesRef.current = [];
            savedPlacesMigratedAtRef.current = null;
            setNeedsOnboarding(true);
            setOnboardingChecked(true);
            setState(prev => ({
              ...initialState,
              savedPlaces: prev.savedPlaces || [],
              favorites: prev.favorites || [],
              partnerSharedPlaces: prev.partnerSharedPlaces || [],
              familyPool: prev.familyPool,
            }));
            setLoading(false);
            setView('onboarding');
          }
        });
      } else {
        authDebugLog('No auth user, routing to login', { reason: 'user_null' });
        setSavedPlacesLoaded(false);
        legacyFavoritesRef.current = [];
        savedPlacesMigratedAtRef.current = null;
        migrationAttemptedRef.current = false;
        aiResetAttemptedRef.current = null;
        lastAuthUidRef.current = null;
        setNeedsOnboarding(false);
        setOnboardingChecked(true);
        setPendingJoinCircleId(null);
        setState(getInitialState(null));
        setView('login');
        setLoading(false);
        console.timeEnd('auth:resolved');
        if (unsubProfile) {
          unsubProfile();
          unsubProfile = null;
        }
      }
    });

    return () => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      unsubscribe();
    };
  }, [authBypassEnabled, isGuest]);

  const handleOnboardingComplete = useCallback(async (result: OnboardingResult) => {
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) {
      setNeedsOnboarding(false);
      setView('dashboard');
      return;
    }
    const completedAt = Timestamp.now();
    try {
      if (accessContext.canSyncCloud) {
        await saveUserField(uid, 'onboardingCompletedAt', completedAt);
        await saveUserField(uid, 'onboardingCompleted', true);
        await saveUserField(uid, 'profileCompletionRequired', result.skipped);
      }
      if (result.userPreferences) {
        handleUpdateState('userPreferences', result.userPreferences);
      }
      if (result.profileInfo) {
        const mergedProfile = { ...(state.profileInfo || {}), ...result.profileInfo };
        handleUpdateState('profileInfo', mergedProfile);
      }
      if (result.preferences) {
        handleUpdateState('preferences', result.preferences);
      }
      if (result.children) {
        handleUpdateState('children', result.children);
      }
      if (result.pets) {
        handleUpdateState('pets', result.pets);
      }
      if (result.partnerLink && !state.partnerLink) {
        handleUpdateState('partnerLink', result.partnerLink);
      }
      setState(prev => ({
        ...prev,
        onboardingCompletedAt: completedAt,
        profileCompletionRequired: result.skipped,
      }));
    } catch (err) {
      console.warn('Failed to persist onboarding state.', err);
    } finally {
      setNeedsOnboarding(false);
      setView('dashboard');
    }
  }, [state.user?.uid, state.profileInfo, state.partnerLink, handleUpdateState, accessContext.canSyncCloud]);

  useEffect(() => {
    if (redirectHandledRef.current) return;
    redirectHandledRef.current = true;
    (async () => {
      try {
        authDebugLog('Checking redirect result on app load', {
          href: typeof window !== 'undefined' ? window.location.href : '',
          pathname: typeof window !== 'undefined' ? window.location.pathname : '',
        });
        if (!isFirebaseConfigured || !auth) {
          return;
        }
        const redirectResult = await getRedirectResult(auth);
        authDebugLog('Redirect result resolved', {
          redirectUid: redirectResult?.user?.uid ?? null,
          currentUserUid: auth.currentUser?.uid ?? null,
          href: typeof window !== 'undefined' ? window.location.href : '',
          pathname: typeof window !== 'undefined' ? window.location.pathname : '',
        });
        if (redirectResult) {
          authDebugLog('Redirect result received', {
            uid: redirectResult.user.uid,
            email: redirectResult.user.email,
            provider: redirectResult.providerId,
          });
          setView('dashboard');
          navigate('/', { replace: true });
        }
      } catch (err: any) {
        if (err?.code === 'auth/unauthorized-domain') {
          setError("This domain is not authorized for Google Sign-In. Please add it to Firebase Console -> Authentication -> Settings -> Authorized domains.");
        } else if (err?.code === 'auth/cancelled-popup-request' || err?.code === 'auth/redirect-cancelled-by-user') {
          setError(null);
        } else if (err) {
          setError(`Login failed: ${err.message || 'Unknown error'}`);
        }
        console.warn('Redirect result error:', err);
      } finally {
        setRedirectChecked(true);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
        }
      }
    })();
  }, [navigate]);

  useEffect(() => {
    authDebugLog('Chosen view', {
      chosenView: view,
      href: typeof window !== 'undefined' ? window.location.href : '',
      pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    });
  }, [view]);

  useEffect(() => {
    if (!BILLING_ENABLED) return;
    if (BILLING_PROVIDER !== 'paystack') return;
    if (!accessContext.canSyncCloud) return;
    if (!isFirebaseConfigured) return;
    const params = new URLSearchParams(window.location.search);
    const isPaymentCallback = params.get('payment_callback') === 'true';
    const ref = params.get('ref');
    if (!isPaymentCallback || !ref) return;
    const uid = auth?.currentUser?.uid || state.user?.uid;
    if (!uid) return;
    (async () => {
      try {
        await fetch(`${API_BASE}/api/paystack/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: ref }),
        });
        await fetch(`${API_BASE}/api/subscription/status/${uid}`);
      } catch (err) {
        console.warn('Payment verification failed', err);
      } finally {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    })();
  }, [accessContext.canSyncCloud]);

  useEffect(() => {
    if (!BILLING_ENABLED) return;
    if (BILLING_PROVIDER !== 'play') return;
    if (!accessContext.canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) return;
    if (playSyncAttemptedRef.current === uid) return;
    playSyncAttemptedRef.current = uid;

    (async () => {
      try {
        const synced = await syncPlayEntitlementWithServer();
        if (synced?.entitlement) {
          setState(prev => ({
            ...prev,
            entitlement: {
              ...prev.entitlement,
              ...synced.entitlement,
            },
          }));
        }
      } catch (err) {
        console.warn('Play subscription sync failed', err);
      }
    })();
  }, [accessContext.canSyncCloud, state.user?.uid]);

  useEffect(() => {
    if (loading) return;
    if (isGuest) return;
    if (!state.user) return;
    if (!authChecked) return;
    if (!onboardingChecked) return;
    if (needsOnboarding) return;
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (view === 'login' || view === 'onboarding' || pathname === '/login') {
      authDebugLog('Authenticated user ready; forcing home navigation', {
        fromView: view,
        pathname,
        reason: 'auth_confirmed',
      });
      setView('dashboard');
      navigate('/', { replace: true });
    }
  }, [loading, isGuest, state.user, authChecked, onboardingChecked, needsOnboarding, view, navigate]);

  useEffect(() => {
    if (!accessContext.canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) return;
    const unsub = listenToSavedPlaces(uid, (places) => {
      setSavedPlacesLoaded(true);
      setState(prev => ({
        ...prev,
        savedPlaces: places,
        favorites: places.length > 0 ? places.map(place => place.placeId) : prev.favorites,
      }));
    });
    return () => unsub();
  }, [accessContext.canSyncCloud, state.user?.uid]);

  const consumeJoinCode = useCallback(async (code: string) => {
    if (!code || joinInFlightRef.current) return;
    if (!accessContext.canSyncCloud) {
      setError('Join links are disabled in auth bypass mode.');
      setView('dashboard');
      navigate('/', { replace: true });
      return;
    }
    if (lastJoinCodeRef.current === code) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    const currentUser = state.user || (auth?.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName,
      email: auth.currentUser.email,
    } : null);
    if (!uid || !currentUser) {
      localStorage.setItem(PENDING_JOIN_KEY, code);
      setView('login');
      return;
    }
    joinInFlightRef.current = true;
    lastJoinCodeRef.current = code;
    try {
      const circle = await joinCircleByCode(code, currentUser);
      setPendingJoinCircleId(circle.id);
      localStorage.removeItem(PENDING_JOIN_KEY);
      setView('dashboard');
      navigate('/', { replace: true });
    } catch (err: any) {
      localStorage.removeItem(PENDING_JOIN_KEY);
      lastJoinCodeRef.current = null;
      if (state.user?.uid) {
        window.alert('Invalid or expired join code. Please ask for a new one.');
        setView('dashboard');
        navigate('/', { replace: true });
      } else {
        setError('Invalid or expired join code. Please ask for a new one.');
        setView('login');
        navigate('/', { replace: true });
      }
      console.warn('Join circle failed.', err);
    } finally {
      joinInFlightRef.current = false;
    }
  }, [state.user, state.user?.uid, navigate, accessContext.canSyncCloud]);

  useEffect(() => {
    if (!accessContext.canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) return;
    const pendingCode = localStorage.getItem(PENDING_JOIN_KEY);
    if (pendingCode) {
      consumeJoinCode(pendingCode);
    }
  }, [accessContext.canSyncCloud, state.user?.uid, consumeJoinCode]);

  const JoinRoute: React.FC = () => {
    const params = useParams();
    const code = params.code?.toUpperCase();
    useEffect(() => {
      if (loading) return;
      if (!code) return;
      if (state.user?.uid || auth?.currentUser?.uid) {
        consumeJoinCode(code);
      } else {
        localStorage.setItem(PENDING_JOIN_KEY, code);
        setView('login');
      }
    }, [code, loading]);
    return renderView();
  };

  useEffect(() => {
    if (!accessContext.canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) return;
    if (!savedPlacesLoaded) return;
    if (migrationAttemptedRef.current) return;
    if (savedPlacesMigratedAtRef.current) return;
    const legacyFavorites = legacyFavoritesRef.current || [];
    if (legacyFavorites.length === 0) {
      migrationAttemptedRef.current = true;
      (async () => {
        try {
          const migratedAt = Timestamp.now();
          await saveUserField(uid, 'savedPlacesMigratedAt', migratedAt);
          savedPlacesMigratedAtRef.current = migratedAt;
        } catch (err) {
          console.warn('Failed to mark savedPlaces migration', err);
        }
      })();
      return;
    }
    const existing = new Set((state.savedPlaces || []).map(place => place.placeId));
    const missing = legacyFavorites.filter(id => !existing.has(id));
    migrationAttemptedRef.current = true;
    (async () => {
      for (const placeId of missing) {
        try {
          const payload: SavedPlace = {
            placeId,
            name: 'Saved place',
            address: '',
            mapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
            savedAt: Timestamp.now(),
          };
          await upsertSavedPlace(uid, payload);
        } catch (err) {
          console.warn('Legacy favorite migration failed', { placeId, err });
        }
      }
      try {
        const migratedAt = Timestamp.now();
        await saveUserField(uid, 'savedPlacesMigratedAt', migratedAt);
        savedPlacesMigratedAtRef.current = migratedAt;
      } catch (err) {
        console.warn('Failed to mark savedPlaces migration', err);
      }
    })();
  }, [accessContext.canSyncCloud, state.user?.uid, savedPlacesLoaded, state.savedPlaces]);

  const renderView = () => {
    authDebugLog('renderView', {
      loading,
      view,
      redirectChecked,
      authChecked,
      onboardingChecked,
      needsOnboarding,
      hasUser: !!state.user,
      isGuest,
      href: typeof window !== 'undefined' ? window.location.href : '',
      pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    });
    
    // Show loading while waiting for auth or onboarding status check
    if (loading) {
      return <div className="flex items-center justify-center h-screen bg-gradient-to-br from-sky-50 to-white"><div className="text-sky-500 text-lg">Loading...</div></div>;
    }

    // Wait for auth state to be checked before showing login
    if (!isGuest && !authChecked) {
      return <div className="flex items-center justify-center h-screen bg-gradient-to-br from-sky-50 to-white"><div className="text-sky-500 text-lg">Loading...</div></div>;
    }

    // For authenticated users, wait for onboarding check to complete BEFORE rendering anything else
    if (!isGuest && state.user && !onboardingChecked) {
      return <div className="flex items-center justify-center h-screen bg-gradient-to-br from-sky-50 to-white"><div className="text-sky-500 text-lg">Loading...</div></div>;
    }

    // If authenticated and needs onboarding, show onboarding (highest priority for authenticated users)
    if (!isGuest && state.user && needsOnboarding) {
      return (
        <Onboarding
          userName={state.user?.displayName || state.user?.email}
          initialProfileInfo={state.profileInfo}
          initialUserPreferences={state.userPreferences}
          initialPreferences={state.preferences}
          initialChildren={state.children}
          initialPets={state.pets}
          initialPartnerLink={state.partnerLink}
          onComplete={handleOnboardingComplete}
        />
      );
    }

    const toggleDiscoveryMode = () => {
      const next = !useNetflixLayout;
      setUseNetflixLayout(next);
      try { localStorage.setItem('fampal_netflix_layout', next ? 'true' : 'false'); } catch {}
    };

    const dashboardProps = {
      state,
      isGuest,
      accessContext,
      onSignOut: handleSignOut,
      setView,
      onUpdateState: handleUpdateState,
      initialCircleId: pendingJoinCircleId,
      onClearInitialCircle: () => setPendingJoinCircleId(null),
      initialTab: dashboardTab,
      onTabChange: (tab: string) => setDashboardTab(tab as typeof dashboardTab),
      discoveryMode: useNetflixLayout,
      onToggleDiscoveryMode: toggleDiscoveryMode,
    };
    const DashboardComponent = Dashboard;

    if (state.user && !needsOnboarding && view === 'login') {
      return <DashboardComponent {...dashboardProps} />;
    }

    switch (view) {
      case 'dashboard':
        return <DashboardComponent {...dashboardProps} />;
      case 'onboarding':
        return (
          <Onboarding
            userName={state.user?.displayName || state.user?.email}
            initialProfileInfo={state.profileInfo}
            initialUserPreferences={state.userPreferences}
            initialPreferences={state.preferences}
            initialChildren={state.children}
            initialPets={state.pets}
            initialPartnerLink={state.partnerLink}
            onComplete={handleOnboardingComplete}
          />
        );
      case 'profile':
        return <Profile state={state} isGuest={isGuest} accessContext={accessContext} onSignOut={handleSignOut} setView={setView} onUpdateState={handleUpdateState} onResetOnboarding={() => setNeedsOnboarding(true)} darkMode={darkMode} onToggleDarkMode={() => { const next = !darkMode; setDarkMode(next); try { localStorage.setItem('fampal_dark_mode', next ? 'true' : 'false'); } catch {} }} />;
      default:
        return <Login onLogin={handleSignIn} onEmailSignIn={handleEmailSignIn} onEmailSignUp={handleEmailSignUp} onForgotPassword={handleForgotPassword} onGuestLogin={handleGuestLogin} error={error} />;
    }
  };

  const showBottomNav = !loading && onboardingChecked && (view === 'dashboard' || view === 'profile') && !needsOnboarding;

  const NavIcon = ({ type, active }: { type: string; active: boolean }) => {
    const cls = `w-[22px] h-[22px] transition-colors ${active ? 'text-sky-500' : 'text-slate-400'}`;
    switch (type) {
      case 'home':
        return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
      case 'saved':
        return <svg className={cls} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>;
      case 'circles':
        return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>;
      case 'profile':
        return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
      default:
        return null;
    }
  };

  const NavButton = ({ type, label, active, onClick }: { type: string; label: string; active: boolean; onClick: () => void }) => (
    <button 
      onClick={onClick}
      aria-label={label}
      className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all min-w-[56px] no-min-size ${
        active ? 'text-sky-500' : 'text-slate-400'
      }`}
    >
      <NavIcon type={type} active={active} />
      <span className={`text-[10px] font-semibold ${active ? 'text-sky-500' : 'text-slate-400'}`}>{label}</span>
    </button>
  );

  return (
    <Routes>
      <Route path="/" element={
        <div>
          {renderView()}
          {showBottomNav && (
            <nav className="fixed bottom-0 left-0 right-0 bottom-nav-blur border-t border-slate-200/60 px-2 pt-2 pb-2 safe-area-inset-bottom z-[100]" style={{ pointerEvents: 'auto' }}>
              <div className="flex justify-around max-w-md mx-auto">
                <NavButton type="home" label="Home" active={view === 'dashboard' && dashboardTab === 'explore'} onClick={() => { setDashboardTab('explore'); setView('dashboard'); }} />
                <NavButton type="saved" label="Saved" active={view === 'dashboard' && dashboardTab === 'favorites'} onClick={() => { setDashboardTab('favorites'); setView('dashboard'); }} />
                <NavButton type="circles" label="Circles" active={view === 'dashboard' && dashboardTab === 'circles'} onClick={() => { setDashboardTab('circles'); setView('dashboard'); }} />
                <NavButton type="profile" label="Profile" active={view === 'profile'} onClick={() => setView('profile')} />
              </div>
            </nav>
          )}
        </div>
      } />
      <Route path="/join/:code" element={<JoinRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
