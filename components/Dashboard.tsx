import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState, Place, Memory, UserReview, ExploreIntent, GroupPlace, VisitedPlace, PLAN_LIMITS, UserPreferences, SavedLocation, SavedPlace, AccessibilityFeatureValue, FamilyFacilityValue, PetFriendlyFeatureValue, UserAccessibilityNeeds } from '../types';
import Header from './Header';
import PlaceCard from './PlaceCard';
import Filters from './Filters';
import FilterPanel from './FilterPanel';
import VenueProfile from './VenueProfile';
import GroupsList from './GroupsList';
import GroupDetail from './GroupDetail';
import PlanBilling from './PlanBilling';
import MustHavesSheet from './MustHavesSheet';
import { UpgradePrompt, LimitIndicator } from './UpgradePrompt';
import { searchExploreIntent, getExploreIntentSubtitle, getPlaceDetails, textSearchPlaces } from '../placesService';
import { getLimits, canSavePlace, canCreateCircle, isPaidTier, getNextResetDate, getCurrentUsageMonth } from '../lib/entitlements';
import { updateLocation, updateRadius, updateCategory, updateActiveCircle } from '../lib/profileSync';
import {
  createDefaultExploreFilters,
  ExploreFilters,
  ExploreLensKey,
  getLensDefinitions,
  getFilterButtonLabel,
  getSelectedChipItems,
} from '../lib/exploreFilters';
import { ShareMemoryModal } from './ShareMemory';
import { db, doc, getDoc, collection, onSnapshot, setDoc, auth, serverTimestamp, increment, storage, ref, uploadBytesResumable, getDownloadURL } from '../lib/firebase';
import { upsertSavedPlace, deleteSavedPlace } from '../lib/userData';
import { loadPlaceAccessibilityByIds, rankPlacesWithAccessibilityNeeds, submitAccessibilityReport } from '../lib/placeAccessibility';
import { generateAccessibilitySummary } from '../src/utils/accessibility';
import { loadPlaceFamilyFacilitiesByIds, submitFamilyFacilitiesReport } from '../lib/placeFamilyFacilities';
import { loadPlacePetFriendlyByIds, submitPetFriendlyReport } from '../lib/placePetFriendly';
import { createReport as createCommunityReport, aggregateReportSignals, type CommunityReportPayload } from '../src/services/communityReports';
import { generateFamilyFacilitiesSummary } from '../src/utils/familyFacilities';
import MemoryCreate from './MemoryCreate';
import {
  CircleDoc,
  createCircle,
  createPartnerCircle,
  joinCircleByCode,
  listenToUserCircles,
  addCircleMemory,
  saveCirclePlace,
  deleteCircle,
} from '../lib/circles';
import { getPartnerThreadId, ensurePartnerThread } from '../lib/partnerThreads';
import { Timestamp } from 'firebase/firestore';
import type { AppAccessContext } from '../lib/access';
import { formatPriceLevel as formatPriceLevelUtil } from '../src/utils/priceLevel';
import ActivityDashboard from './ActivityDashboard';

interface DashboardProps {
  state: AppState;
  isGuest: boolean;
  accessContext?: AppAccessContext;
  onSignOut: () => void;
  setView: (view: string) => void;
  onUpdateState: (key: keyof AppState, value: any) => void;
  initialCircleId?: string | null;
  onClearInitialCircle?: () => void;
  initialTab?: 'explore' | 'favorites' | 'activity' | 'memories' | 'circles' | 'partner';
  onTabChange?: (tab: string) => void;
  discoveryMode?: boolean;
  onToggleDiscoveryMode?: () => void;
}

interface PartnerNote {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

type TabButtonProps = { label: string; count?: number; active: boolean; onClick: () => void };
const TabButton: React.FC<TabButtonProps> = ({ label, count, active, onClick }) => (
  <button 
    onClick={onClick}
    aria-label={`${label}${count !== undefined && count > 0 ? `, ${count} items` : ''}`}
    className={`px-4 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0 min-h-[44px] ${
      active ? 'stitch-chip-active text-[#b35b00]' : 'stitch-chip'
    }`}
  >
    {label}{count !== undefined && count > 0 ? ` (${count})` : ''}
  </button>
);


function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const Dashboard: React.FC<DashboardProps> = ({ state, isGuest, accessContext, onSignOut, setView, onUpdateState, initialCircleId, onClearInitialCircle, initialTab, onTabChange, discoveryMode, onToggleDiscoveryMode }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const shouldLogDev = import.meta.env.DEV;
  const canSyncCloud = accessContext?.canSyncCloud ?? !isGuest;
  const effectiveGuestForPersistence = !canSyncCloud;
  const userPrefs = state.userPreferences || {};
  const [activeTab, setActiveTab] = useState<'explore' | 'favorites' | 'activity' | 'memories' | 'circles' | 'partner'>(initialTab || 'explore');
  
  React.useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  
  const handleTabChange = (tab: 'explore' | 'favorites' | 'activity' | 'memories' | 'circles' | 'partner') => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  const hasLinkedPartner = state.partnerLink?.status === 'accepted';
  const partnerUserId = state.partnerLink?.partnerUserId;
  const partnerName = state.partnerLink?.partnerName?.trim();
  const partnerEmail = state.partnerLink?.partnerEmail;
  const partnerPhotoURL = state.partnerLink?.partnerPhotoURL;
  const partnerIdLabel = partnerUserId
    ? `Partner linked · ${partnerUserId.slice(0, 6)}…${partnerUserId.slice(-4)}`
    : 'Partner linked';
  const partnerLabel = partnerName || partnerIdLabel;
  const partnerInitial = partnerName ? partnerName[0].toUpperCase() : 'P';
  const [partnerNotes, setPartnerNotes] = useState<PartnerNote[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSending, setNoteSending] = useState(false);
  const [newPartnerCircleName, setNewPartnerCircleName] = useState('');
  const [creatingPartnerCircle, setCreatingPartnerCircle] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<ExploreIntent>(userPrefs.lastCategory || 'all');
  const [exploreFilters, setExploreFilters] = useState<ExploreFilters>(() => createDefaultExploreFilters());
  const [showMustHavesSheet, setShowMustHavesSheet] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [manualRefreshTrigger, setManualRefreshTrigger] = useState(0);
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeAccessibilityById, setPlaceAccessibilityById] = useState<Record<string, AccessibilityFeatureValue[]>>({});
  const [placeAccessibilitySummaryById, setPlaceAccessibilitySummaryById] = useState<Record<string, string>>({});
  const [submittingAccessibilityForPlaceId, setSubmittingAccessibilityForPlaceId] = useState<string | null>(null);
  const [placeFamilyFacilitiesById, setPlaceFamilyFacilitiesById] = useState<Record<string, FamilyFacilityValue[]>>({});
  const [placeFamilyFacilitiesSummaryById, setPlaceFamilyFacilitiesSummaryById] = useState<Record<string, string>>({});
  const [submittingFamilyFacilitiesForPlaceId, setSubmittingFamilyFacilitiesForPlaceId] = useState<string | null>(null);
  const [placePetFriendlyById, setPlacePetFriendlyById] = useState<Record<string, PetFriendlyFeatureValue[]>>({});
  const [placePetFriendlySummaryById, setPlacePetFriendlySummaryById] = useState<Record<string, string>>({});
  const [submittingPetFriendlyForPlaceId, setSubmittingPetFriendlyForPlaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagingComplete, setPagingComplete] = useState(false);
  const [exploreResultState, setExploreResultState] = useState<'none' | 'exhausted' | 'filters_strict'>('none');
  const [placesServerConfigured, setPlacesServerConfigured] = useState<boolean | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [selectedPlaceTrust, setSelectedPlaceTrust] = useState<import('../src/services/communityReports').AggregatedReportSignals | null>(null);
  // Location state - hydrate from saved preferences
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(
    userPrefs.lastLocation ? { lat: userPrefs.lastLocation.lat, lng: userPrefs.lastLocation.lng } : null
  );
  const [locationName, setLocationName] = useState(userPrefs.lastLocation?.label || 'Locating...');
  const [locationError, setLocationError] = useState<string | null>(null);
  const isEditingLocationRef = useRef(false);
  const isEditingRadiusRef = useRef(false);
  const isEditingCategoryRef = useRef(false);
  const locationEditTimeoutRef = useRef<number | null>(null);
  const radiusEditTimeoutRef = useRef<number | null>(null);
  const categoryEditTimeoutRef = useRef<number | null>(null);
  
  // Radius slider state (in km) - hydrate from saved preferences
  const [radiusKm, setRadiusKm] = useState(userPrefs.lastRadius || 10);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  
  // Preference filter mode: all (no filter), family (everyone), partner (adults), solo (just me)
  const [prefFilterMode, setPrefFilterMode] = useState<'all' | 'family' | 'partner' | 'solo'>('all');
  
  // Hide saved places toggle - show fresh discoveries only
  const [hideSavedPlaces, setHideSavedPlaces] = useState(false);
  
  // Preference update callbacks - persist to database with debouncing
  const persistLocation = useCallback((lat: number, lng: number, label: string) => {
    const newPrefs = updateLocation({ lat, lng, label }, effectiveGuestForPersistence, userPrefs);
    onUpdateState('userPreferences', newPrefs);
  }, [effectiveGuestForPersistence, userPrefs, onUpdateState]);
  
  const persistRadius = useCallback((radius: number) => {
    const newPrefs = updateRadius(radius, effectiveGuestForPersistence, userPrefs);
    onUpdateState('userPreferences', newPrefs);
  }, [effectiveGuestForPersistence, userPrefs, onUpdateState]);
  
  const persistCategory = useCallback((category: ExploreIntent) => {
    const newPrefs = updateCategory(category, effectiveGuestForPersistence, userPrefs);
    onUpdateState('userPreferences', newPrefs);
  }, [effectiveGuestForPersistence, userPrefs, onUpdateState]);
  
  // Circles state
  const [circles, setCircles] = useState<CircleDoc[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<CircleDoc | null>(null);
  const [addToCirclePlace, setAddToCirclePlace] = useState<Place | null>(null);
  
  // Computed: separate partner circles from regular circles
  const partnerCircles = circles.filter(c => c.isPartnerCircle);
  const regularCircles = circles.filter(c => !c.isPartnerCircle);
  
  // Computed: Combined preferences based on filter mode
  const combinedPreferences = useMemo(() => {
    const myPrefs = state.preferences || { foodPreferences: [], allergies: [], accessibility: [], activityPreferences: [] };
    const childrenPrefs = state.children.map(c => c.preferences || { foodPreferences: [], allergies: [], accessibility: [], activityPreferences: [] });
    // Partner preferences would come from partner's profile - for now we just note partner is included
    
    if (prefFilterMode === 'solo') {
      return {
        allergies: [...new Set(myPrefs.allergies)],
        accessibility: [...new Set(myPrefs.accessibility)],
        foodPreferences: [...new Set(myPrefs.foodPreferences)],
        activityPreferences: [...new Set(myPrefs.activityPreferences)],
        includesPartner: false,
        includesChildren: false,
      };
    }
    
    if (prefFilterMode === 'partner') {
      return {
        allergies: [...new Set(myPrefs.allergies)],
        accessibility: [...new Set(myPrefs.accessibility)],
        foodPreferences: [...new Set(myPrefs.foodPreferences)],
        activityPreferences: [...new Set(myPrefs.activityPreferences)],
        includesPartner: true,
        includesChildren: false,
      };
    }
    
    if (prefFilterMode === 'family') {
      const allAllergies = [...myPrefs.allergies];
      const allAccessibility = [...myPrefs.accessibility];
      const allFood = [...myPrefs.foodPreferences];
      const allActivity = [...myPrefs.activityPreferences];
      
      childrenPrefs.forEach(cp => {
        allAllergies.push(...cp.allergies);
        allAccessibility.push(...cp.accessibility);
        allFood.push(...cp.foodPreferences);
        allActivity.push(...cp.activityPreferences);
      });
      
      return {
        allergies: [...new Set(allAllergies)],
        accessibility: [...new Set(allAccessibility)],
        foodPreferences: [...new Set(allFood)],
        activityPreferences: [...new Set(allActivity)],
        includesPartner: hasLinkedPartner,
        includesChildren: state.children.length > 0,
      };
    }
    
    // 'all' mode - no filtering
    return {
      allergies: [],
      accessibility: [],
      foodPreferences: [],
      activityPreferences: [],
      includesPartner: false,
      includesChildren: false,
    };
  }, [prefFilterMode, state.preferences, state.children, hasLinkedPartner]);
  
  // Upgrade prompt state
  const [showUpgradePrompt, setShowUpgradePrompt] = useState<'savedPlaces' | 'memories' | 'circles' | null>(null);
  
  // Share memory state
  const [shareMemory, setShareMemory] = useState<Memory | null>(null);
  const [partnerSharedMemories, setPartnerSharedMemories] = useState<Memory[]>([]);
  
  // Plan & Billing modal
  const [showPlanBilling, setShowPlanBilling] = useState(false);
  
  // Entitlement limits
  const limits = accessContext?.limits ?? getLimits(state.entitlement);
  const isPaid = accessContext?.isPro ?? isPaidTier(state.entitlement);
  const enrichInFlightRef = useRef<Set<string>>(new Set());
  const fallbackImage = 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=400&h=300&fit=crop';
  const placesSearchKeyRef = useRef<string>('');
  const placesRequestIdRef = useRef<number>(0);
  const placesAbortControllerRef = useRef<AbortController | null>(null);
  const cacheSeededRef = useRef<boolean>(false);
  const familyPoolResetRef = useRef<string | null>(null);
  const partnerLinkRequiresPro = import.meta.env.VITE_PARTNER_LINK_REQUIRES_PRO === 'true';
  const canLinkPartner = !partnerLinkRequiresPro || isPaid;
  const isPartnerPending = state.partnerLink?.status === 'pending';
  
  useEffect(() => {
    return () => {
      if (locationEditTimeoutRef.current) window.clearTimeout(locationEditTimeoutRef.current);
      if (radiusEditTimeoutRef.current) window.clearTimeout(radiusEditTimeoutRef.current);
      if (categoryEditTimeoutRef.current) window.clearTimeout(categoryEditTimeoutRef.current);
    };
  }, []);

  // Get user's location on mount (only if not already saved)
  useEffect(() => {
    // If we have saved preferences, don't re-fetch geolocation
    if (userPrefs.lastLocation) {
      return;
    }
    
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      setLocationName('Unknown Location');
      setUserLocation({ lat: 37.7749, lng: -122.4194 });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        
        // Reverse geocode to get location name
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await response.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || 'Your Area';
          setLocationName(city);
          // Persist the detected location
          persistLocation(latitude, longitude, city);
        } catch (err) {
          setLocationName('Your Area');
          persistLocation(latitude, longitude, 'Your Area');
        }
      },
      (error) => {
        console.error('Location error:', error);
        setLocationError('Unable to get location');
        setLocationName('Unknown Location');
        setUserLocation({ lat: 37.7749, lng: -122.4194 });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, [userPrefs.lastLocation, persistLocation]);

  useEffect(() => {
    if (!db) return;
    const link = state.partnerLink;
    if (!link?.partnerUserId) return;
    if (link.partnerName && link.partnerPhotoURL && link.partnerEmail) return;

    let cancelled = false;
    const loadPartnerProfile = async () => {
      try {
        const partnerDoc = await getDoc(doc(db, 'users', link.partnerUserId));
        if (!partnerDoc.exists()) return;
        const data = partnerDoc.data() || {};
        const profile = data.profile || {};
        const nextName = link.partnerName || profile.displayName || profile.email;
        const nextEmail = link.partnerEmail || profile.email;
        const nextPhoto = link.partnerPhotoURL || profile.photoURL;
        if (!nextName && !nextEmail && !nextPhoto) return;
        if (!cancelled) {
          onUpdateState('partnerLink', {
            ...link,
            partnerName: nextName,
            partnerEmail: nextEmail,
            partnerPhotoURL: nextPhoto,
          });
        }
      } catch (err) {
        console.warn('Partner profile lookup failed.', err);
      }
    };

    loadPartnerProfile();
    return () => {
      cancelled = true;
    };
  }, [state.partnerLink, onUpdateState]);

  useEffect(() => {
    if (!canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    const partnerId = state.partnerLink?.partnerUserId;
    if (!uid || !partnerId) return;
    if (state.partnerLink?.status !== 'accepted') return;
    ensurePartnerThread(uid, partnerId).catch(err => {
      console.warn('Failed to ensure partner thread', err);
    });
  }, [canSyncCloud, state.user?.uid, state.partnerLink?.partnerUserId, state.partnerLink?.status]);

  useEffect(() => {
    if (!canSyncCloud || !state.user?.uid) {
      setCircles([]);
      return;
    }
    return listenToUserCircles(state.user.uid, (next) => {
      setCircles(next);
    });
  }, [canSyncCloud, state.user?.uid]);

  useEffect(() => {
    if (!initialCircleId) return;
    if (circles.length === 0) return;
    const found = circles.find(circle => circle.id === initialCircleId);
    if (found) {
      setSelectedCircle(found);
      if (onClearInitialCircle) {
        onClearInitialCircle();
      }
    }
  }, [initialCircleId, circles, onClearInitialCircle]);

  useEffect(() => {
    if (!db) return;
    if (!state.user?.uid) return;
    if (!canSyncCloud) return;
    const link = state.partnerLink;
    if (!link?.partnerUserId || link.status !== 'accepted') {
      setPartnerNotes([]);
      setNoteError(null);
      return;
    }
    let unsub: (() => void) | null = null;
    let cancelled = false;
    const threadId = getPartnerThreadId(state.user.uid, link.partnerUserId);
    (async () => {
      try {
        await ensurePartnerThread(state.user!.uid, link.partnerUserId);
        if (cancelled) return;
        const notesRef = collection(db, 'partnerThreads', threadId, 'notes');
        unsub = onSnapshot(notesRef, (snap) => {
          const nextNotes = snap.docs.map((docSnap) => {
            const data = docSnap.data() as Omit<PartnerNote, 'id'>;
            return { id: docSnap.id, ...data };
          });
          nextNotes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          setPartnerNotes(nextNotes);
        }, (err: any) => {
          console.warn('Partner notes listener error.', err);
          if (err?.code === 'permission-denied') {
            setNoteError('Partner notes are unavailable (permission denied).');
          } else {
            setNoteError('Unable to load notes right now.');
          }
        });
      } catch (err) {
        console.warn('Failed to initialize partner notes thread.', err);
      }
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [state.user?.uid, state.partnerLink, canSyncCloud]);

  useEffect(() => {
    if (!db) return;
    if (!canSyncCloud) return;
    const uid = state.user?.uid;
    const link = state.partnerLink;
    if (!uid || !link?.partnerUserId || link.status !== 'accepted') {
      onUpdateState('partnerSharedPlaces', []);
      setPartnerSharedMemories([]);
      onUpdateState('familyPool', undefined);
      return;
    }
    let unsubPlaces: (() => void) | null = null;
    let unsubMemories: (() => void) | null = null;
    let unsubThread: (() => void) | null = null;
    let cancelled = false;
    const threadId = getPartnerThreadId(uid, link.partnerUserId);
    (async () => {
      try {
        await ensurePartnerThread(uid, link.partnerUserId);
        if (cancelled) return;
        const placesRef = collection(db, 'partnerThreads', threadId, 'sharedPlaces');
        const memoriesRef = collection(db, 'partnerThreads', threadId, 'sharedMemories');
        const threadRef = doc(db, 'partnerThreads', threadId);

        unsubPlaces = onSnapshot(placesRef, (snap) => {
          const nextPlaces = snap.docs.map(docSnap => docSnap.data() as GroupPlace);
          nextPlaces.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
          onUpdateState('partnerSharedPlaces', nextPlaces);
        }, (err: any) => {
          console.warn('Partner shared places listener error.', err);
        });

        unsubMemories = onSnapshot(memoriesRef, (snap) => {
          const nextMemories = snap.docs.map(docSnap => {
            const data = docSnap.data() as Omit<Memory, 'id'>;
            return { id: docSnap.id, ...data };
          });
          nextMemories.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          setPartnerSharedMemories(nextMemories);
        }, (err: any) => {
          console.warn('Partner shared memories listener error.', err);
        });

        unsubThread = onSnapshot(threadRef, (snap) => {
          const data = snap.data() || {};
          const pool = data.entitlementPool;
          const isFamilyPlan = state.entitlement?.plan_tier === 'family';
          if (isFamilyPlan) {
            const poolResetDate = pool?.ai_requests_reset_date;
            const nextResetDate = getNextResetDate();
            const resetKey = `${threadId}:${poolResetDate || 'none'}`;
            const shouldReset = poolResetDate ? new Date() >= new Date(poolResetDate) : true;
            if (shouldReset && familyPoolResetRef.current !== resetKey) {
              familyPoolResetRef.current = resetKey;
              setDoc(threadRef, {
                entitlementPool: {
                  plan_tier: 'family',
                  ai_requests_this_month: 0,
                  ai_requests_reset_date: nextResetDate,
                },
                updatedAt: serverTimestamp(),
              }, { merge: true }).catch(err => {
                console.warn('Failed to reset family AI pool.', err);
              });
            } else if (!pool?.ai_requests_reset_date && familyPoolResetRef.current !== resetKey) {
              familyPoolResetRef.current = resetKey;
              setDoc(threadRef, {
                entitlementPool: {
                  plan_tier: 'family',
                  ai_requests_this_month: pool?.ai_requests_this_month || 0,
                  ai_requests_reset_date: nextResetDate,
                },
                updatedAt: serverTimestamp(),
              }, { merge: true }).catch(err => {
                console.warn('Failed to initialize family AI pool.', err);
              });
            }
          }

          if (isFamilyPlan && pool) {
            onUpdateState('familyPool', {
              ai_requests_this_month: pool.ai_requests_this_month || 0,
              ai_requests_reset_date: pool.ai_requests_reset_date || getNextResetDate(),
            });
          } else {
            onUpdateState('familyPool', undefined);
          }
        }, (err: any) => {
          console.warn('Partner thread listener error.', err);
        });
      } catch (err) {
        console.warn('Failed to initialize partner thread listeners.', err);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubPlaces) unsubPlaces();
      if (unsubMemories) unsubMemories();
      if (unsubThread) unsubThread();
    };
  }, [state.user?.uid, state.partnerLink, canSyncCloud, onUpdateState]);

  const handleSendPartnerNote = async () => {
    if (!noteInput.trim()) {
      setNoteError('Please enter a note before sending.');
      return;
    }
    if (!canSyncCloud || !db || !state.user?.uid) {
      setNoteError('Please sign in to send notes.');
      return;
    }
    if (!state.partnerLink?.partnerUserId || state.partnerLink.status !== 'accepted') {
      setNoteError('Link a partner to send notes.');
      return;
    }

    setNoteError(null);
    setNoteSending(true);
    const uid = state.user.uid;
    const link = state.partnerLink;
    const threadId = getPartnerThreadId(uid, link.partnerUserId);
    const notesRef = collection(db, 'partnerThreads', threadId, 'notes');

    const createdByName = state.user.displayName || state.user.email || 'You';
    const noteId = `${Date.now()}`;
    const notePayload = {
      text: noteInput.trim(),
      createdAt: new Date().toISOString(),
      createdBy: uid,
      createdByName,
    };

    try {
      await ensurePartnerThread(uid, link.partnerUserId);
      await setDoc(doc(notesRef, noteId), notePayload);
      await setDoc(doc(db, 'partnerThreads', threadId), { updatedAt: serverTimestamp() }, { merge: true });
      setNoteInput('');
    } catch (err: any) {
      console.warn('Failed to send partner note.', err);
      if (err?.code === 'permission-denied') {
        setNoteError('Permission denied. Please re-link your partner.');
      } else {
        setNoteError('Failed to send note. Please try again.');
      }
    } finally {
      setNoteSending(false);
    }
  };

  const handleShareMemoryExternal = async (memory: Memory) => {
    const shareText = `${memory.caption}${memory.placeName ? `\n@${memory.placeName}` : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'FamPals Memory',
          text: shareText,
        });
        setShareStatus('Shared!');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setShareStatus('Copied to clipboard.');
      } else {
        window.prompt('Copy this memory text:', shareText);
      }
    } catch (err) {
      console.warn('Memory share failed.', err);
      setShareStatus('Unable to share right now.');
    } finally {
      setTimeout(() => setShareStatus(null), 2000);
    }
  };

  const applyFlickerGuard = useCallback((previous: Place[], incoming: Place[]): Place[] => {
    if (previous.length === 0 || incoming.length === 0) return incoming;
    const previousIds = new Set(previous.map((place) => place.id));
    const incomingIds = new Set(incoming.map((place) => place.id));
    let changed = 0;
    previousIds.forEach((id) => {
      if (!incomingIds.has(id)) changed += 1;
    });
    incomingIds.forEach((id) => {
      if (!previousIds.has(id)) changed += 1;
    });
    const baseline = Math.max(previousIds.size, 1);
    const deltaRatio = changed / baseline;
    if (deltaRatio > 0.05) return incoming;

    const appended = incoming.filter((place) => !previousIds.has(place.id));
    if (appended.length === 0) return previous;
    return [...previous, ...appended];
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const response = await fetch(`${apiBase}/api/health`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && typeof data?.placesConfigured === 'boolean') {
          setPlacesServerConfigured(data.placesConfigured);
        }
      } catch {
        // Keep silent on health check failures.
      }
    };
    checkHealth();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  // Fetch places when location, filter, radius, or search changes - uses Google Places API (fast, no AI cost)
  useEffect(() => {
    const requestId = ++placesRequestIdRef.current;
    placesAbortControllerRef.current?.abort();
    const controller = new AbortController();
    placesAbortControllerRef.current = controller;
    if (activeTab !== 'explore' || !userLocation) {
      return;
    }

    const fetchPlaces = async () => {
      const searchKey = `${userLocation.lat.toFixed(3)}:${userLocation.lng.toFixed(3)}:${selectedFilter}:${radiusKm}:${prefFilterMode}:${hideSavedPlaces ? 'discover' : 'all'}:${manualRefreshTrigger}`;
      placesSearchKeyRef.current = searchKey;
      setLoading(true);
      setLoadingMore(false);
      setPagingComplete(false);
      setExploreResultState('none');
      cacheSeededRef.current = false;
      try {
        const result = await searchExploreIntent(
          selectedFilter,
          userLocation.lat,
          userLocation.lng,
          radiusKm,
          {
            searchKey,
            cacheContext: `${prefFilterMode}:${hideSavedPlaces ? 'discover' : 'all'}`,
            exploreFilters,
            userPreferences: combinedPreferences,
            signal: controller.signal,
            isCancelled: () =>
              placesSearchKeyRef.current !== searchKey || placesRequestIdRef.current !== requestId,
            onProgress: (update) => {
              if (placesSearchKeyRef.current !== searchKey || placesRequestIdRef.current !== requestId) return;
              if (update.fromCache) {
                cacheSeededRef.current = true;
                setPlaces(update.places);
              } else {
                setPlaces((prev) => (cacheSeededRef.current ? applyFlickerGuard(prev, update.places) : update.places));
              }
              setLoadingMore(update.isBackgroundLoading);
            },
          }
        );
        if (placesSearchKeyRef.current !== searchKey || placesRequestIdRef.current !== requestId) return;
        setPlaces((prev) => (cacheSeededRef.current ? applyFlickerGuard(prev, result.places) : result.places));
        cacheSeededRef.current = false;
        if (import.meta.env.DEV) {
          if (shouldLogDev) {
            console.log('[FamPals] Intent debug summary:', result.debug);
          }
        }
        const pipeline = result.debug?.pipeline;
        if (pipeline?.hardFilteredOut) {
          setExploreResultState('filters_strict');
        } else if (pipeline?.cacheLow && pipeline?.googleLow) {
          setExploreResultState('exhausted');
        } else {
          setExploreResultState('none');
        }
        setPagingComplete(true);
      } catch (error) {
        if ((error as any)?.name === 'AbortError') {
          return;
        }
        console.error('Error fetching places:', error);
        setExploreResultState('none');
      } finally {
        if (placesSearchKeyRef.current === searchKey && placesRequestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };

    fetchPlaces();
    return () => {
      controller.abort();
    };
  }, [selectedFilter, activeTab, userLocation, radiusKm, applyFlickerGuard, exploreFilters, prefFilterMode, hideSavedPlaces, manualRefreshTrigger]);

  useEffect(() => {
    if (!canSyncCloud) return;
    const prefs = state.userPreferences;
    if (!prefs) return;

    if (!isEditingRadiusRef.current && typeof prefs.lastRadius === 'number' && prefs.lastRadius !== radiusKm) {
      setRadiusKm(prefs.lastRadius);
    }

    if (!isEditingCategoryRef.current && prefs.lastCategory && prefs.lastCategory !== selectedFilter) {
      setSelectedFilter(prefs.lastCategory);
    }

    if (!isEditingLocationRef.current && prefs.lastLocation) {
      const next = prefs.lastLocation;
      const current = userLocation;
      const sameLatLng = current &&
        Math.abs(current.lat - next.lat) < 0.00001 &&
        Math.abs(current.lng - next.lng) < 0.00001;
      if (!sameLatLng) {
        setUserLocation({ lat: next.lat, lng: next.lng });
      }
      if (next.label && next.label !== locationName) {
        setLocationName(next.label);
      }
      if (locationError) {
        setLocationError(null);
      }
    }
  }, [state.userPreferences, radiusKm, selectedFilter, userLocation, locationName, locationError, isGuest]);
  
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setIsSearchMode(false);
      setSearchResults([]);
      return;
    }
    if (!userLocation) return;
    setIsSearchMode(true);
    handleTabChange('explore');
    setSearchLoading(true);
    try {
      const results = await textSearchPlaces(query.trim(), userLocation.lat, userLocation.lng, radiusKm);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };
  
  // Refresh GPS location from device
  const refreshGpsLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }
    setLocationName('Getting location...');
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await response.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || 'Your Area';
          setLocationName(city);
          persistLocation(latitude, longitude, city);
        } catch (err) {
          setLocationName('Your Area');
          persistLocation(latitude, longitude, 'Your Area');
        }
      },
      (error) => {
        console.error('Location error:', error);
        setLocationError('Unable to get location. Check permissions.');
        setLocationName('Unknown Location');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Handle location change from postcode input
  const handleLocationChange = async (postcode: string): Promise<void> => {
    isEditingLocationRef.current = true;
    if (locationEditTimeoutRef.current) {
      window.clearTimeout(locationEditTimeoutRef.current);
    }
    setLocationName('Searching...');
    setLocationError(null);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(postcode)}&format=json&limit=1&countrycodes=za`,
        {
          headers: {
            'User-Agent': 'FamPals/1.0 (Family Adventure App)'
          }
        }
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lon);
        const shortName = display_name.split(',')[0];
        setUserLocation({ lat: parsedLat, lng: parsedLng });
        setLocationName(shortName);
        // Persist the new location
        persistLocation(parsedLat, parsedLng, shortName);
      } else {
        setLocationError('Location not found. Try a different address.');
        setLocationName('Unknown');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setLocationError('Failed to find location. Please try again.');
      setLocationName('Your Area');
    } finally {
      locationEditTimeoutRef.current = window.setTimeout(() => {
        isEditingLocationRef.current = false;
      }, 800);
    }
  };
  
  // Handler for radius slider that also persists
  const handleRadiusSliderChange = (newRadius: number) => {
    isEditingRadiusRef.current = true;
    if (radiusEditTimeoutRef.current) {
      window.clearTimeout(radiusEditTimeoutRef.current);
    }
    radiusEditTimeoutRef.current = window.setTimeout(() => {
      isEditingRadiusRef.current = false;
    }, 800);
    setRadiusKm(newRadius);
    persistRadius(newRadius);
  };
  
  // Handler for category filter that also persists
  const handleFilterChange = (category: ExploreIntent) => {
    isEditingCategoryRef.current = true;
    if (categoryEditTimeoutRef.current) {
      window.clearTimeout(categoryEditTimeoutRef.current);
    }
    categoryEditTimeoutRef.current = window.setTimeout(() => {
      isEditingCategoryRef.current = false;
    }, 800);
    setSelectedFilter(category);
    persistCategory(category);
  };

  const lensDefinitions = useMemo(
    () => getLensDefinitions(selectedFilter, prefFilterMode),
    [selectedFilter, prefFilterMode]
  );

  const toggleLensChip = useCallback((lensKey: ExploreLensKey, chipId: string) => {
    setExploreFilters((prev) => {
      const current = prev[lensKey];
      const next = current.includes(chipId)
        ? current.filter((value) => value !== chipId)
        : [...current, chipId];
      return { ...prev, [lensKey]: next };
    });
  }, []);

  const toggleLensStrict = useCallback((lensKey: ExploreLensKey) => {
    setExploreFilters((prev) => ({
      ...prev,
      strict: {
        ...prev.strict,
        [lensKey]: !prev.strict[lensKey],
      },
    }));
  }, []);

  const clearExploreFilters = useCallback(() => {
    setExploreFilters(createDefaultExploreFilters());
  }, []);

  const mapSavedPlaceToPlace = (saved: SavedPlace): Place => {
    const place: Place = {
      id: saved.placeId,
      name: saved.name || 'Saved place',
      description: saved.address || saved.description || 'Address unavailable',
      address: saved.address || '',
      rating: saved.rating,
      tags: saved.tags || [],
      mapsUrl: saved.mapsUrl || `https://www.google.com/maps/place/?q=place_id:${saved.placeId}`,
      type: saved.type || 'all',
      priceLevel: saved.priceLevel,
      imageUrl: saved.imageUrl || fallbackImage,
      accessibility: placeAccessibilityById[saved.placeId],
      accessibilitySummary:
        placeAccessibilitySummaryById[saved.placeId] ||
        generateAccessibilitySummary(placeAccessibilityById[saved.placeId] || []),
      familyFacilities: placeFamilyFacilitiesById[saved.placeId],
      familyFacilitiesSummary:
        placeFamilyFacilitiesSummaryById[saved.placeId] ||
        generateFamilyFacilitiesSummary(placeFamilyFacilitiesById[saved.placeId] || []),
      petFriendly: placePetFriendlyById[saved.placeId],
      petFriendlySummary: placePetFriendlySummaryById[saved.placeId],
    };
    return place;
  };

  const savedPlaces = state.savedPlaces || [];
  const accessibilityPlaceIds = useMemo(
    () => [...new Set([...places.map((place) => place.id), ...savedPlaces.map((saved) => saved.placeId)])],
    [places, savedPlaces]
  );

  useEffect(() => {
    if (accessibilityPlaceIds.length === 0) return;
    let cancelled = false;
    loadPlaceAccessibilityByIds(accessibilityPlaceIds)
      .then(({ accessibilityById, summaryById }) => {
        if (cancelled) return;
        setPlaceAccessibilityById((prev) => ({ ...prev, ...accessibilityById }));
        setPlaceAccessibilitySummaryById((prev) => ({ ...prev, ...summaryById }));
      })
      .catch((err) => {
        console.warn('Failed to load place accessibility summaries', err);
      });
    return () => {
      cancelled = true;
    };
  }, [accessibilityPlaceIds]);

  useEffect(() => {
    if (!db || accessibilityPlaceIds.length === 0) return;
    const unsubs = accessibilityPlaceIds.map((placeId) =>
      onSnapshot(doc(db, 'places', placeId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { accessibility?: AccessibilityFeatureValue[]; accessibilitySummary?: string };
        if (Array.isArray(data.accessibility)) {
          setPlaceAccessibilityById((prev) => ({ ...prev, [placeId]: data.accessibility || [] }));
        }
        if (typeof data.accessibilitySummary === 'string') {
          setPlaceAccessibilitySummaryById((prev) => ({ ...prev, [placeId]: data.accessibilitySummary || '' }));
        }
      })
    );
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [accessibilityPlaceIds]);

  useEffect(() => {
    if (accessibilityPlaceIds.length === 0) return;
    let cancelled = false;
    loadPlaceFamilyFacilitiesByIds(accessibilityPlaceIds)
      .then(({ familyFacilitiesById, summaryById }) => {
        if (cancelled) return;
        setPlaceFamilyFacilitiesById((prev) => ({ ...prev, ...familyFacilitiesById }));
        setPlaceFamilyFacilitiesSummaryById((prev) => ({ ...prev, ...summaryById }));
      })
      .catch((err) => {
        console.warn('Failed to load place family facilities summaries', err);
      });
    return () => {
      cancelled = true;
    };
  }, [accessibilityPlaceIds]);

  useEffect(() => {
    if (!db || accessibilityPlaceIds.length === 0) return;
    const unsubs = accessibilityPlaceIds.map((placeId) =>
      onSnapshot(doc(db, 'places', placeId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { familyFacilities?: FamilyFacilityValue[]; familyFacilitiesSummary?: string };
        if (Array.isArray(data.familyFacilities)) {
          setPlaceFamilyFacilitiesById((prev) => ({ ...prev, [placeId]: data.familyFacilities || [] }));
        }
        if (typeof data.familyFacilitiesSummary === 'string') {
          setPlaceFamilyFacilitiesSummaryById((prev) => ({ ...prev, [placeId]: data.familyFacilitiesSummary || '' }));
        }
      })
    );
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [accessibilityPlaceIds]);

  useEffect(() => {
    if (!db || accessibilityPlaceIds.length === 0) return;
    const unsubs = accessibilityPlaceIds.map((placeId) =>
      onSnapshot(doc(db, 'places', placeId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { petFriendly?: PetFriendlyFeatureValue[]; petFriendlySummary?: string };
        if (Array.isArray(data.petFriendly)) {
          setPlacePetFriendlyById((prev) => ({ ...prev, [placeId]: data.petFriendly || [] }));
        }
        if (typeof data.petFriendlySummary === 'string') {
          setPlacePetFriendlySummaryById((prev) => ({ ...prev, [placeId]: data.petFriendlySummary || '' }));
        }
      })
    );
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [accessibilityPlaceIds]);

  const buildSavedPlaceSnapshot = (place: Place): SavedPlace => ({
    placeId: place.id,
    name: place.name,
    address: place.address || '',
    imageUrl: place.imageUrl,
    mapsUrl: place.mapsUrl || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
    rating: place.rating,
    priceLevel: place.priceLevel,
    savedAt: Timestamp.now(),
  });

  const priceLevelToString = (level?: number | string): string | undefined => {
    const result = formatPriceLevelUtil(level);
    return result === '—' ? undefined : result;
  };

  const toggleFavorite = (place: Place) => {
    const isRemoving = state.favorites.includes(place.id);
    
    if (!isRemoving) {
      const saveCheck = canSavePlace(accessContext?.entitlement ?? state.entitlement, state.favorites.length);
      if (!saveCheck.allowed) {
        setShowUpgradePrompt('savedPlaces');
        return;
      }
    }
    
    const newFavorites = isRemoving
      ? state.favorites.filter(id => id !== place.id)
      : [...state.favorites, place.id];
    onUpdateState('favorites', newFavorites);
    const nextSavedPlaces = isRemoving
      ? savedPlaces.filter(saved => saved.placeId !== place.id)
      : [...savedPlaces.filter(saved => saved.placeId !== place.id), buildSavedPlaceSnapshot(place)];
    onUpdateState('savedPlaces', nextSavedPlaces);

    if (!canSyncCloud) return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) {
      console.warn('toggleFavorite: missing user uid');
      return;
    }
    if (isRemoving) {
      deleteSavedPlace(uid, place.id).catch(err => {
        console.warn('Failed to delete saved place', err);
      });
    } else {
      const snapshot = buildSavedPlaceSnapshot(place);
      upsertSavedPlace(uid, snapshot).catch(err => {
        console.warn('Failed to save place snapshot', err);
      });
    }
  };

  const mapToCommunityReport = (
    accessibilityFeatures: AccessibilityFeatureValue[],
    familyFeatures: FamilyFacilityValue[],
    comment?: string
  ): CommunityReportPayload => {
    const accessibilityMap: Record<string, string> = {
      step_free_entry: 'step_free',
      ramp_access: 'step_free',
      accessible_toilet: 'accessible_toilets',
      wide_doorways: 'wheelchair_friendly',
      accessible_parking: 'wheelchair_friendly',
    };
    const kidPrefsMap: Record<string, string> = {
      kids_menu: 'kids_menu',
      high_chairs: 'high_chair',
      playground: 'play_area_jungle_gym',
      child_friendly_space: 'outdoor_space',
      stroller_friendly: 'stroller_friendly',
    };

    const accessibility: Partial<Record<string, boolean>> = {};
    accessibilityFeatures.forEach((f) => {
      const mapped = accessibilityMap[f.feature];
      if (mapped) accessibility[mapped] = f.value;
    });

    const kidPrefs: Partial<Record<string, boolean>> = {};
    familyFeatures.forEach((f) => {
      const mapped = kidPrefsMap[f.feature];
      if (mapped) kidPrefs[mapped] = f.value;
    });

    return {
      kidPrefs: kidPrefs as CommunityReportPayload['kidPrefs'],
      accessibility: accessibility as CommunityReportPayload['accessibility'],
      notes: comment,
    };
  };

  const handleSubmitAccessibilityContribution = async (
    placeId: string,
    payload: { features: AccessibilityFeatureValue[]; comment?: string }
  ) => {
    if (!canSyncCloud) {
      alert('Contributions are disabled in read-only review mode.');
      return;
    }
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) {
      alert('You need to be signed in to contribute.');
      return;
    }
    setSubmittingAccessibilityForPlaceId(placeId);
    try {
      const updated = await submitAccessibilityReport({
        placeId,
        userId: uid,
        userDisplayName: state.user?.displayName || state.user?.email || 'Member',
        features: payload.features,
        comment: payload.comment,
      });
      setPlaceAccessibilityById((prev) => ({ ...prev, [placeId]: updated.accessibility }));
      setPlaceAccessibilitySummaryById((prev) => ({ ...prev, [placeId]: updated.accessibilitySummary }));
      setPlaces((prev) =>
        prev.map((place) =>
          place.id === placeId
            ? { ...place, accessibility: updated.accessibility, accessibilitySummary: updated.accessibilitySummary }
            : place
        )
      );
      setSelectedPlace((prev) =>
        prev && prev.id === placeId
          ? { ...prev, accessibility: updated.accessibility, accessibilitySummary: updated.accessibilitySummary }
          : prev
      );

      try {
        const communityPayload = mapToCommunityReport(payload.features, [], payload.comment);
        await createCommunityReport(placeId, communityPayload);
      } catch (crErr) {
        console.warn('Community report creation failed (non-blocking):', crErr);
      }
    } catch (err) {
      console.warn('Failed to submit accessibility contribution', err);
      throw err;
    } finally {
      setSubmittingAccessibilityForPlaceId(null);
    }
  };

  const handleSubmitFamilyFacilitiesContribution = async (
    placeId: string,
    payload: { features: FamilyFacilityValue[]; comment?: string }
  ) => {
    if (!canSyncCloud) {
      alert('Contributions are disabled in read-only review mode.');
      return;
    }
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) {
      alert('You need to be signed in to contribute.');
      return;
    }
    setSubmittingFamilyFacilitiesForPlaceId(placeId);
    try {
      const updated = await submitFamilyFacilitiesReport({
        placeId,
        userId: uid,
        userDisplayName: state.user?.displayName || state.user?.email || 'Member',
        features: payload.features,
        comment: payload.comment,
      });

      setPlaceFamilyFacilitiesById((prev: Record<string, FamilyFacilityValue[]>) => ({ ...prev, [placeId]: updated.familyFacilities }));
      setPlaceFamilyFacilitiesSummaryById((prev: Record<string, string>) => ({ ...prev, [placeId]: updated.familyFacilitiesSummary }));
      setPlaces((prev) =>
        prev.map((place) =>
          place.id === placeId
            ? { ...place, familyFacilities: updated.familyFacilities, familyFacilitiesSummary: updated.familyFacilitiesSummary }
            : place
        )
      );
      setSelectedPlace((prev) =>
        prev && prev.id === placeId
          ? { ...prev, familyFacilities: updated.familyFacilities, familyFacilitiesSummary: updated.familyFacilitiesSummary }
          : prev
      );

      try {
        const communityPayload = mapToCommunityReport([], payload.features, payload.comment);
        await createCommunityReport(placeId, communityPayload);
      } catch (crErr) {
        console.warn('Community report creation failed (non-blocking):', crErr);
      }
    } catch (err) {
      console.warn('Failed to submit family facilities contribution', err);
      throw err;
    } finally {
      setSubmittingFamilyFacilitiesForPlaceId(null);
    }
  };

  const handleSubmitPetFriendlyContribution = async (
    placeId: string,
    payload: { features: PetFriendlyFeatureValue[]; comment?: string }
  ) => {
    if (!canSyncCloud) {
      alert('Contributions are disabled in read-only review mode.');
      return;
    }
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) {
      alert('You need to be signed in to contribute.');
      return;
    }
    setSubmittingPetFriendlyForPlaceId(placeId);
    try {
      const updated = await submitPetFriendlyReport({
        placeId,
        userId: uid,
        userDisplayName: state.user?.displayName || state.user?.email || 'Member',
        features: payload.features,
        comment: payload.comment,
      });

      setPlacePetFriendlyById((prev) => ({ ...prev, [placeId]: updated.petFriendly }));
      setPlacePetFriendlySummaryById((prev) => ({ ...prev, [placeId]: updated.petFriendlySummary }));
      setPlaces((prev) =>
        prev.map((place) =>
          place.id === placeId
            ? { ...place, petFriendly: updated.petFriendly, petFriendlySummary: updated.petFriendlySummary }
            : place
        )
      );
      setSelectedPlace((prev) =>
        prev && prev.id === placeId
          ? { ...prev, petFriendly: updated.petFriendly, petFriendlySummary: updated.petFriendlySummary }
          : prev
      );
    } catch (err) {
      console.warn('Failed to submit pet-friendly contribution', err);
      throw err;
    } finally {
      setSubmittingPetFriendlyForPlaceId(null);
    }
  };

  const handleAddPartnerPlace = async (groupPlace: GroupPlace) => {
    if (!canSyncCloud || !db || !state.user?.uid || !state.partnerLink?.partnerUserId) {
      alert('Please sign in and link a partner first.');
      return;
    }
    try {
      const threadId = await ensurePartnerThread(state.user.uid, state.partnerLink.partnerUserId);
      const placeRef = doc(db, 'partnerThreads', threadId, 'sharedPlaces', groupPlace.placeId);
      await setDoc(placeRef, groupPlace, { merge: true });
      await setDoc(doc(db, 'partnerThreads', threadId), { updatedAt: serverTimestamp() }, { merge: true });
      alert(`Added "${groupPlace.placeName}" to Partner Plans!`);
    } catch (err: any) {
      console.warn('Failed to save partner shared place.', err);
      if (err?.code === 'permission-denied') {
        alert('Permission denied. Please re-link your partner.');
      } else {
        alert('Failed to add to Partner Plans. Please try again.');
      }
    }
  };

  useEffect(() => {
    if (!canSyncCloud) return;
    if (activeTab !== 'favorites') return;
    const uid = state.user?.uid || auth?.currentUser?.uid;
    if (!uid) return;
    const missing = savedPlaces.filter((place) => {
      const isPlaceholderName = !place.name || place.name === 'Saved place';
      return isPlaceholderName || !place.address || !place.imageUrl || !place.mapsUrl || place.rating === undefined;
    }).filter(place => !enrichInFlightRef.current.has(place.placeId));

    if (missing.length === 0) return;

    const queue = missing.slice(0, 6);
    let active = 0;
    const maxConcurrent = 2;

    const runNext = async () => {
      if (queue.length === 0) return;
      if (active >= maxConcurrent) return;
      const nextPlace = queue.shift();
      if (!nextPlace) return;
      active += 1;
      enrichInFlightRef.current.add(nextPlace.placeId);
      try {
        const details = await getPlaceDetails(nextPlace.placeId);
        if (!details) return;
        const updated: SavedPlace = {
          placeId: nextPlace.placeId,
          name: details.name || nextPlace.name || 'Saved place',
          address: details.address || nextPlace.address || '',
          imageUrl: details.photos?.[0] || nextPlace.imageUrl,
          mapsUrl: details.mapsUrl || nextPlace.mapsUrl || `https://www.google.com/maps/place/?q=place_id:${nextPlace.placeId}`,
          rating: details.rating ?? nextPlace.rating,
          priceLevel: priceLevelToString(details.priceLevel) || nextPlace.priceLevel,
          savedAt: nextPlace.savedAt || Timestamp.now(),
        };
        await upsertSavedPlace(uid, updated);
      } catch (err) {
        console.warn('Saved place enrichment failed', { placeId: nextPlace.placeId, err });
      } finally {
        enrichInFlightRef.current.delete(nextPlace.placeId);
        active -= 1;
        if (queue.length > 0) {
          runNext();
        }
      }
    };

    for (let i = 0; i < maxConcurrent; i += 1) {
      runNext();
    }
  }, [activeTab, canSyncCloud, savedPlaces, state.user?.uid]);

  const markVisited = (place: Place) => {
    const visitedPlaces = state.visitedPlaces || [];
    const isAlreadyVisited = visitedPlaces.some(v => v.placeId === place.id);
    
    if (isAlreadyVisited) {
      const updated = visitedPlaces.filter(v => v.placeId !== place.id);
      onUpdateState('visitedPlaces', updated);
    } else {
      const newVisit: VisitedPlace = {
        placeId: place.id,
        placeName: place.name,
        placeType: place.type,
        imageUrl: place.imageUrl,
        visitedAt: new Date().toISOString(),
        notes: '',
        isFavorite: state.favorites.includes(place.id),
      };
      onUpdateState('visitedPlaces', [...visitedPlaces, newVisit]);
      import('../src/services/gamification').then(m => { m.awardPoints('mark_visited'); m.invalidateGamificationCache(); }).catch(() => {});
    }
  };

  const handleAddMemory = useCallback((memory: Omit<Memory, 'id'>) => {
    const newMemory: Memory = { ...memory, id: Date.now().toString() };
    onUpdateState('memories', [...state.memories, newMemory]);
    import('../src/services/gamification').then(m => { m.awardPoints('save_memory'); m.invalidateGamificationCache(); }).catch(() => {});
    if (canSyncCloud && db && state.partnerLink?.status === 'accepted' && state.partnerLink.partnerUserId && memory.sharedWithPartner && state.user?.uid) {
      const threadId = getPartnerThreadId(state.user.uid, state.partnerLink.partnerUserId);
      const sharedRef = doc(db, 'partnerThreads', threadId, 'sharedMemories', newMemory.id);
      const payload: Omit<Memory, 'id'> = {
        placeId: newMemory.placeId,
        placeName: newMemory.placeName,
        photoUrl: newMemory.photoUrl,
        photoUrls: newMemory.photoUrls,
        photoThumbUrl: newMemory.photoThumbUrl,
        photoThumbUrls: newMemory.photoThumbUrls,
        caption: newMemory.caption,
        taggedFriends: newMemory.taggedFriends,
        date: newMemory.date,
        sharedWithPartner: true,
        circleIds: newMemory.circleIds,
        geo: newMemory.geo,
      };
      ensurePartnerThread(state.user.uid, state.partnerLink.partnerUserId)
        .then(() => setDoc(sharedRef, payload, { merge: true }))
        .then(() => setDoc(doc(db, 'partnerThreads', threadId), { updatedAt: serverTimestamp() }, { merge: true }))
        .catch((err) => console.warn('Failed to share memory with partner.', err));
    }

    if (memory.placeId) {
      const visitedPlaces = state.visitedPlaces || [];
      const alreadyVisited = visitedPlaces.some(v => v.placeId === memory.placeId);
      if (!alreadyVisited) {
        const selectedVenue = places.find(p => p.id === memory.placeId);
        const newVisit: VisitedPlace = {
          placeId: memory.placeId,
          placeName: memory.placeName,
          placeType: selectedVenue?.type || 'all',
          imageUrl: selectedVenue?.imageUrl,
          visitedAt: new Date().toISOString(),
          notes: '',
          isFavorite: state.favorites.includes(memory.placeId),
        };
        onUpdateState('visitedPlaces', [...visitedPlaces, newVisit]);
      }
    }
  }, [onUpdateState, places, state.favorites, state.memories, state.visitedPlaces, canSyncCloud, state.partnerLink, state.user?.uid]);

  const memoryPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingMemoryId, setUploadingMemoryId] = useState<string | null>(null);

  const handleAddPhotoToMemory = useCallback(async (memoryId: string, file: File) => {
    if (!storage || !auth?.currentUser) {
      console.error('[FamPals] Cannot add photo: storage or auth missing');
      return;
    }
    setUploadingMemoryId(memoryId);
    try {
      const timestamp = Date.now();
      const baseName = `memories/${auth.currentUser.uid}/edit/${timestamp}`;

      const loadImg = (f: File): Promise<HTMLImageElement | ImageBitmap> => {
        if ('createImageBitmap' in window) return createImageBitmap(f);
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(f);
        });
      };
      const compress = async (f: File, maxW: number, q: number): Promise<Blob> => {
        const image = await loadImg(f);
        const w = 'width' in image ? image.width : (image as ImageBitmap).width;
        const h = 'height' in image ? image.height : (image as ImageBitmap).height;
        const scale = Math.min(1, maxW / w);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
        if ('close' in image) (image as ImageBitmap).close();
        return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('fail')), 'image/jpeg', q));
      };

      const uploadWithTimeout = (storageRef: any, blob: Blob, label: string): Promise<string> => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`${label} upload timed out`)), 30000);
          try {
            const task = uploadBytesResumable(storageRef, blob);
            task.on('state_changed',
              (snap: any) => {
                if (shouldLogDev) {
                  console.log(`[FamPals] ${label}: ${Math.round((snap.bytesTransferred / snap.totalBytes) * 100)}%`);
                }
              },
              (err: any) => { clearTimeout(timeout); reject(err); },
              async () => {
                clearTimeout(timeout);
                try { resolve(await getDownloadURL(task.snapshot.ref)); }
                catch (e) { reject(e); }
              }
            );
          } catch (e) { clearTimeout(timeout); reject(e); }
        });
      };

      if (shouldLogDev) {
        console.log('[FamPals] Adding photo to memory', memoryId, 'file:', file.name, file.size);
      }
      const fullBlob = await compress(file, 1600, 0.7);
      const thumbBlob = await compress(file, 400, 0.6);
      if (shouldLogDev) {
        console.log('[FamPals] Compressed. Full:', fullBlob.size, 'Thumb:', thumbBlob.size);
      }
      const fullRef = ref(storage, `${baseName}_full.jpg`);
      const thumbRef = ref(storage, `${baseName}_thumb.jpg`);

      const [fullUrl, thumbUrl] = await Promise.all([
        uploadWithTimeout(fullRef, fullBlob, 'Photo'),
        uploadWithTimeout(thumbRef, thumbBlob, 'Thumbnail'),
      ]);
      if (shouldLogDev) {
        console.log('[FamPals] Photo added to memory successfully');
      }

      const updated = state.memories.map(m => {
        if (m.id !== memoryId) return m;
        return {
          ...m,
          photoUrl: fullUrl,
          photoUrls: [fullUrl],
          photoThumbUrl: thumbUrl,
          photoThumbUrls: [thumbUrl],
        };
      });
      onUpdateState('memories', updated);
    } catch (err: any) {
      console.error('[FamPals] Failed to add photo to memory:', err?.code, err?.message || err);
      const msg = err?.code === 'storage/unauthorized'
        ? 'Storage permission denied. Check Firebase Storage rules.'
        : err?.message?.includes('timed out')
        ? 'Upload timed out. Check your connection and try again.'
        : `Upload failed: ${err?.message || 'Unknown error'}`;
      alert(msg);
    } finally {
      setUploadingMemoryId(null);
    }
  }, [state.memories, onUpdateState]);

  const favoritePlaces = savedPlaces.map(mapSavedPlaceToPlace);
  const accessibilityNeeds: UserAccessibilityNeeds = state.accessibilityNeeds || {
    usesWheelchair: false,
    needsStepFree: false,
    needsAccessibleToilet: false,
    prefersPavedPaths: false,
    usesPushchair: false,
  };
  const placesWithAccessibility = useMemo(
    () =>
      places.map((place) => {
        const accessibility = placeAccessibilityById[place.id] || place.accessibility || [];
        const familyFacilities = placeFamilyFacilitiesById[place.id] || place.familyFacilities || [];
        const petFriendly = placePetFriendlyById[place.id] || place.petFriendly || [];
        return {
          ...place,
          accessibility,
          accessibilitySummary:
            placeAccessibilitySummaryById[place.id] ||
            place.accessibilitySummary ||
            generateAccessibilitySummary(accessibility),
          familyFacilities,
          familyFacilitiesSummary:
            placeFamilyFacilitiesSummaryById[place.id] ||
            place.familyFacilitiesSummary ||
            generateFamilyFacilitiesSummary(familyFacilities),
          petFriendly,
          petFriendlySummary: placePetFriendlySummaryById[place.id] || place.petFriendlySummary || '',
        };
      }),
    [places, placeAccessibilityById, placeAccessibilitySummaryById, placeFamilyFacilitiesById, placeFamilyFacilitiesSummaryById, placePetFriendlyById, placePetFriendlySummaryById]
  );
  const rankedPlaces = useMemo(
    () => rankPlacesWithAccessibilityNeeds(placesWithAccessibility, accessibilityNeeds),
    [placesWithAccessibility, accessibilityNeeds]
  );
  const visibleExplorePlaces = useMemo(
    () => rankedPlaces.filter(place => !hideSavedPlaces || !state.favorites.includes(place.id)),
    [rankedPlaces, hideSavedPlaces, state.favorites]
  );
  const selectedLensChipItems = useMemo(
    () => getSelectedChipItems(exploreFilters, lensDefinitions),
    [exploreFilters, lensDefinitions]
  );
  const mustHavesButtonLabel = useMemo(
    () => getFilterButtonLabel(exploreFilters, lensDefinitions),
    [exploreFilters, lensDefinitions]
  );
  useEffect(() => {
    if (shouldLogDev) {
      console.log('[FamPals] Explore lens filters changed:', exploreFilters);
      console.log(`[FamPals] Explore list count from pipeline output: ${visibleExplorePlaces.length}`);
    }
  }, [exploreFilters, visibleExplorePlaces.length, shouldLogDev]);

  const selectedPlaceWithAccessibility = selectedPlace
    ? {
      ...selectedPlace,
      accessibility: placeAccessibilityById[selectedPlace.id] || selectedPlace.accessibility || [],
      accessibilitySummary:
        placeAccessibilitySummaryById[selectedPlace.id] ||
        selectedPlace.accessibilitySummary ||
        generateAccessibilitySummary(placeAccessibilityById[selectedPlace.id] || selectedPlace.accessibility || []),
      familyFacilities: placeFamilyFacilitiesById[selectedPlace.id] || selectedPlace.familyFacilities || [],
      familyFacilitiesSummary:
        placeFamilyFacilitiesSummaryById[selectedPlace.id] ||
        selectedPlace.familyFacilitiesSummary ||
        generateFamilyFacilitiesSummary(placeFamilyFacilitiesById[selectedPlace.id] || selectedPlace.familyFacilities || []),
      petFriendly: placePetFriendlyById[selectedPlace.id] || selectedPlace.petFriendly || [],
      petFriendlySummary: placePetFriendlySummaryById[selectedPlace.id] || selectedPlace.petFriendlySummary || '',
    }
    : null;

  const handleIncrementAiRequests = async () => {
    const currentUsageMonth = getCurrentUsageMonth();
    const isNewMonth = !!state.entitlement?.usage_reset_month && state.entitlement.usage_reset_month !== currentUsageMonth;
    const current = isNewMonth ? 0 : (state.entitlement?.gemini_credits_used ?? state.entitlement?.ai_requests_this_month ?? 0);
    const usageResetMonth = currentUsageMonth;
    if (
      canSyncCloud &&
      state.entitlement?.plan_tier === 'family' &&
      state.partnerLink?.status === 'accepted' &&
      state.partnerLink?.partnerUserId &&
      state.user?.uid &&
      db
    ) {
      const threadId = getPartnerThreadId(state.user.uid, state.partnerLink.partnerUserId);
      const resetDate = state.familyPool?.ai_requests_reset_date || state.entitlement?.ai_requests_reset_date || getNextResetDate();
      try {
        await setDoc(doc(db, 'partnerThreads', threadId), {
          entitlementPool: {
            plan_tier: 'family',
            ai_requests_this_month: increment(1),
            ai_requests_reset_date: resetDate,
          },
          updatedAt: serverTimestamp(),
        }, { merge: true });
        onUpdateState('familyPool', {
          ai_requests_this_month: (state.familyPool?.ai_requests_this_month || 0) + 1,
          ai_requests_reset_date: resetDate,
        });
      } catch (err) {
        console.warn('Failed to increment family AI pool.', err);
      }
      return;
    }

    onUpdateState('entitlement', {
      ...state.entitlement,
      gemini_credits_used: current + 1,
      usage_reset_month: usageResetMonth,
      ai_requests_this_month: current + 1
    });
  };

  const handleCreateCircle = async (name: string) => {
    if (!canSyncCloud) {
      window.alert('Circle editing is disabled in read-only review mode.');
      return;
    }
    const circleCheck = canCreateCircle(accessContext?.entitlement ?? state.entitlement, regularCircles.length);
    if (!circleCheck.allowed) {
      setShowUpgradePrompt('circles');
      return;
    }
    const currentUser = state.user || (auth?.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName,
      email: auth.currentUser.email,
    } : null);
    if (!currentUser) {
      window.alert('Please sign in to create a circle.');
      return;
    }
    try {
      await createCircle(name, currentUser);
    } catch (err) {
      console.error('Failed to create circle.', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      window.alert(`Failed to create circle: ${message}`);
    }
  };

  const handleJoinCircle = async (code: string) => {
    if (!canSyncCloud) {
      window.alert('Circle editing is disabled in read-only review mode.');
      return;
    }
    const currentUser = state.user || (auth?.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName,
      email: auth.currentUser.email,
    } : null);
    if (!currentUser) {
      window.alert('Please sign in to join a circle.');
      return;
    }
    try {
      await joinCircleByCode(code, currentUser);
    } catch (err) {
      console.error('Failed to join circle.', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      window.alert(`Failed to join circle: ${message}`);
    }
  };

  const handleDeleteCircle = async (circleId: string) => {
    if (!canSyncCloud) {
      window.alert('Circle editing is disabled in read-only review mode.');
      return;
    }
    const currentUser = state.user || (auth?.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName,
      email: auth.currentUser.email,
    } : null);
    if (!currentUser) {
      window.alert('Please sign in to delete a circle.');
      return;
    }
    try {
      await deleteCircle(circleId, currentUser.uid);
    } catch (err) {
      console.error('Failed to delete circle.', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      window.alert(`Failed to delete circle: ${message}`);
    }
  };

  const handleCreatePartnerCircle = async () => {
    if (!canSyncCloud) {
      window.alert('Partner circle editing is disabled in read-only review mode.');
      return;
    }
    if (!newPartnerCircleName.trim()) return;
    if (!state.user || !partnerUserId) {
      window.alert('Please link with a partner first.');
      return;
    }
    setCreatingPartnerCircle(true);
    try {
      await createPartnerCircle(
        newPartnerCircleName.trim(),
        { uid: state.user.uid, displayName: state.user.displayName, email: state.user.email },
        { uid: partnerUserId, displayName: partnerName || null, email: partnerEmail || null }
      );
      setNewPartnerCircleName('');
    } catch (err) {
      console.error('Failed to create partner circle.', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      window.alert(`Failed to create partner circle: ${message}`);
    } finally {
      setCreatingPartnerCircle(false);
    }
  };

  const handleTagMemoryToCircle = async (circleId: string, memory: Omit<Memory, 'id'>) => {
    if (!canSyncCloud) return;
    if (!state.user) return;
    try {
      await addCircleMemory(circleId, {
        id: `${Date.now()}`,
        memoryId: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        createdByUid: state.user.uid,
        createdByName: state.user.displayName || state.user.email || 'Member',
        memorySnapshot: {
          caption: memory.caption,
          placeId: memory.placeId,
          placeName: memory.placeName,
          photoUrl: memory.photoUrl,
          photoUrls: memory.photoUrls,
          photoThumbUrl: memory.photoThumbUrl,
          photoThumbUrls: memory.photoThumbUrls,
          date: memory.date,
        },
      });
    } catch (err) {
      console.warn('Failed to tag memory to circle.', err);
    }
  };

  useEffect(() => {
    if (!selectedPlace) {
      setSelectedPlaceTrust(null);
      return;
    }
    let cancelled = false;
    aggregateReportSignals(selectedPlace.id).then((signals) => {
      if (!cancelled) setSelectedPlaceTrust(signals);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedPlace?.id]);

  const showCircleDetail = !!selectedCircle;
  const showPlaceDetail = !!selectedPlaceWithAccessibility;

  return (
    <div className={`min-h-screen stitch-shell pb-32 ${showPlaceDetail ? '' : 'container-safe'}`}>
      {!showCircleDetail && !showPlaceDetail && (
        <Header 
          setView={setView} 
          user={state.user} 
          locationName={locationName} 
          onSearch={handleSearch}
          onLocationChange={handleLocationChange}
        />
      )}

      {showPlaceDetail ? (
        <VenueProfile 
          place={selectedPlaceWithAccessibility} 
          isFavorite={state.favorites.includes(selectedPlaceWithAccessibility.id)}
          isVisited={(state.visitedPlaces || []).some(v => v.placeId === selectedPlaceWithAccessibility.id)}
          memories={state.memories}
          memoryCount={state.memories.length}
          onToggleFavorite={() => toggleFavorite(selectedPlaceWithAccessibility)}
          onMarkVisited={() => markVisited(selectedPlaceWithAccessibility)}
          onClose={() => setSelectedPlace(null)}
          onUpdateDetails={(data) => {
            const newDetails = { ...state.favoriteDetails, [selectedPlaceWithAccessibility.id]: { ...state.favoriteDetails[selectedPlaceWithAccessibility.id], ...data, placeId: selectedPlaceWithAccessibility.id } };
            onUpdateState('favoriteDetails', newDetails);
          }}
          favoriteData={state.favoriteDetails[selectedPlaceWithAccessibility.id]}
          childrenAges={state.children?.map(c => c.age) || []}
          isGuest={isGuest}
          entitlement={accessContext?.entitlement ?? state.entitlement}
          familyPool={state.familyPool}
          onIncrementAiRequests={handleIncrementAiRequests}
          circles={circles}
          partnerLink={state.partnerLink}
          userName={state.user?.displayName || 'You'}
          userId={state.user?.uid || ''}
          tripContext={prefFilterMode !== 'all' ? combinedPreferences : undefined}
          onSubmitAccessibilityContribution={(votes) => handleSubmitAccessibilityContribution(selectedPlaceWithAccessibility.id, votes)}
          isSubmittingAccessibilityContribution={submittingAccessibilityForPlaceId === selectedPlaceWithAccessibility.id}
          onSubmitFamilyFacilitiesContribution={(votes) => handleSubmitFamilyFacilitiesContribution(selectedPlaceWithAccessibility.id, votes)}
          isSubmittingFamilyFacilitiesContribution={submittingFamilyFacilitiesForPlaceId === selectedPlaceWithAccessibility.id}
          onSubmitPetFriendlyContribution={(votes) => handleSubmitPetFriendlyContribution(selectedPlaceWithAccessibility.id, votes)}
          isSubmittingPetFriendlyContribution={submittingPetFriendlyForPlaceId === selectedPlaceWithAccessibility.id}
          communityTrust={selectedPlaceTrust}
          onTagMemoryToCircle={handleTagMemoryToCircle}
          onAddToCircle={(circleId, groupPlace) => {
            if (circleId === 'partner') {
              const currentPartnerPlaces = state.partnerSharedPlaces || [];
              if (currentPartnerPlaces.some(p => p.placeId === groupPlace.placeId)) {
                alert('This place is already in Partner Plans!');
                return;
              }
              handleAddPartnerPlace(groupPlace);
            } else {
              if (!canSyncCloud) {
                alert('Please sign in to add places to circles.');
                return;
              }
              const circle = circles.find(c => c.id === circleId);
              const note = prompt('Add a note for this place (optional):') || '';
              saveCirclePlace(circleId, {
                placeId: groupPlace.placeId,
                savedByUid: state.user?.uid || 'guest',
                savedByName: state.user?.displayName || state.user?.email || 'Member',
                savedAt: new Date().toISOString(),
                note: note.trim(),
                placeSummary: {
                  placeId: groupPlace.placeId,
                  name: groupPlace.placeName,
                  imageUrl: groupPlace.imageUrl,
                  type: groupPlace.placeType,
                },
              }).then(() => {
                alert(`Added to ${circle?.name || 'circle'}!`);
              }).catch(err => {
                console.error('Failed to save circle place:', err);
                alert('Failed to add to circle. Please try again.');
              });
            }
          }}
          onAddMemory={handleAddMemory}
        />
      ) : selectedCircle ? (
        <GroupDetail
          circle={selectedCircle}
          userId={state.user?.uid || ''}
          userName={state.user?.displayName || state.user?.email || 'Member'}
          userEmail={state.user?.email}
          userFavorites={state.favorites}
          allPlaces={[...places, ...favoritePlaces]}
          onClose={() => setSelectedCircle(null)}
          onOpenPlace={(place) => setSelectedPlace(place)}
        />
      ) : (
        <div className="px-4 py-4">
        <div className="mb-4 rounded-[2rem] bg-white/55 p-2 shadow-[0_14px_30px_rgba(24,0,82,0.05)]">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 scroll-pl-4" style={{ scrollPaddingLeft: '1rem', scrollPaddingRight: '1rem' }}>
          <TabButton label="Explore" active={activeTab === 'explore'} onClick={() => handleTabChange('explore')} />
          <TabButton label="Saved" count={state.favorites.length} active={activeTab === 'favorites'} onClick={() => handleTabChange('favorites')} />
          <TabButton label="My Activity" active={activeTab === 'activity'} onClick={() => handleTabChange('activity')} />
          <TabButton label="Memories" count={state.memories.length} active={activeTab === 'memories'} onClick={() => handleTabChange('memories')} />
          <TabButton label="Partner" active={activeTab === 'partner'} onClick={() => handleTabChange('partner')} />
          <TabButton label="Circles" count={circles.length} active={activeTab === 'circles'} onClick={() => handleTabChange('circles')} />
        </div>
        </div>

        {activeTab === 'explore' && (
          <>
            <Filters selected={selectedFilter} onChange={handleFilterChange} />
            {placesServerConfigured === false && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-700">
                  Places API is not configured on the server. Explore results may be limited.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => setShowFilterPanel(true)}
                className="stitch-card-soft flex-1 h-11 flex items-center gap-2 px-4 text-sm font-semibold text-slate-700 active:bg-slate-50"
              >
                <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                <span>Filters</span>
                {(prefFilterMode !== 'all' || hideSavedPlaces || selectedLensChipItems.length > 0 || radiusKm !== 10) && (
                  <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-[#ff8c00] text-white text-[10px] font-bold">
                    {[prefFilterMode !== 'all', hideSavedPlaces, selectedLensChipItems.length > 0, radiusKm !== 10].filter(Boolean).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setManualRefreshTrigger(prev => prev + 1)}
                className="stitch-pill-button h-11 px-4 text-sm font-bold flex items-center gap-2 min-w-[100px] justify-center"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                Refresh
              </button>
            </div>

            {(prefFilterMode !== 'all' || radiusKm !== 10 || selectedLensChipItems.length > 0 || hideSavedPlaces) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {radiusKm !== 10 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">{radiusKm} km</span>
                )}
                {prefFilterMode !== 'all' && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-[#e6f6ff] text-[#0052FF]">
                    {prefFilterMode === 'family' ? 'Family' : prefFilterMode === 'partner' ? 'Partner' : 'Solo'}
                  </span>
                )}
                {hideSavedPlaces && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-[#fff2e2] text-[#b35b00]">Fresh only</span>
                )}
                {selectedLensChipItems.slice(0, 3).map((chip) => (
                  <span key={`${chip.lensKey}:${chip.chipId}`} className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-[#e6f6ff] text-[#0052FF]">
                    {chip.label}
                  </span>
                ))}
                {selectedLensChipItems.length > 3 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                    +{selectedLensChipItems.length - 3} more
                  </span>
                )}
              </div>
            )}

            {locationError && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-3 text-amber-700 text-xs font-bold">
                {locationError}. Showing default location.
              </div>
            )}

            <FilterPanel
              isOpen={showFilterPanel}
              onClose={() => setShowFilterPanel(false)}
              onApply={() => setManualRefreshTrigger(prev => prev + 1)}
              selectedFilter={selectedFilter}
              onFilterChange={handleFilterChange}
              radiusKm={radiusKm}
              onRadiusChange={handleRadiusSliderChange}
              prefFilterMode={prefFilterMode}
              onPrefFilterModeChange={setPrefFilterMode}
              hasLinkedPartner={hasLinkedPartner}
              partnerLabel={partnerLabel}
              combinedPreferences={combinedPreferences}
              childrenCount={state.children.length}
              discoveryMode={discoveryMode}
              onToggleDiscoveryMode={() => onToggleDiscoveryMode?.()}
              hideSavedPlaces={hideSavedPlaces}
              onToggleHideSavedPlaces={() => setHideSavedPlaces(!hideSavedPlaces)}
              onRefreshLocation={refreshGpsLocation}
              locationError={locationError}
              onOpenMustHaves={() => setShowMustHavesSheet(true)}
              mustHavesButtonLabel={mustHavesButtonLabel}
              selectedLensChipItems={selectedLensChipItems}
              onToggleLensChip={toggleLensChip}
              onClearExploreFilters={clearExploreFilters}
              subtitleText={getExploreIntentSubtitle(selectedFilter)}
            />

            {isSearchMode && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3 px-1">
                  <p className="text-sm font-bold text-slate-700">
                    {searchLoading ? 'Searching...' : `Results for "${searchQuery}"`}
                  </p>
                  <button
                    onClick={() => { setIsSearchMode(false); setSearchResults([]); setSearchQuery(''); }}
                    className="text-xs font-bold text-purple-500 active:text-purple-700"
                  >
                    Clear search
                  </button>
                </div>
                {searchLoading ? (
                  <div className="py-16 text-center text-slate-300 font-black text-xs uppercase tracking-widest">
                    Searching nearby...
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="space-y-4">
                    {searchResults.map(place => (
                      <PlaceCard
                        key={place.id}
                        place={place}
                        variant="list"
                        isFavorite={state.favorites.includes(place.id)}
                        onToggleFavorite={() => toggleFavorite(place)}
                        onClick={() => setSelectedPlace(place)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                    <p className="text-slate-500 font-semibold">No places found for "{searchQuery}"</p>
                    <p className="text-slate-400 text-sm mt-1">Try a different name or expand your search radius</p>
                  </div>
                )}
              </div>
            )}

            {!isSearchMode && (loading || !userLocation) ? (
              <div className="py-24 text-center text-slate-300 font-black text-xs uppercase tracking-widest">
                {!userLocation ? 'Getting your location...' : 'Finding adventures...'}
              </div>
            ) : !isSearchMode ? (
              <div className="space-y-4 mt-4">
                {visibleExplorePlaces.map(place => (
                  <PlaceCard 
                    key={place.id} 
                    place={place}
                    variant="list"
                    isFavorite={state.favorites.includes(place.id)}
                    onToggleFavorite={() => toggleFavorite(place)}
                    onClick={() => setSelectedPlace(place)}
                  />
                ))}
                {hideSavedPlaces && visibleExplorePlaces.length === 0 && rankedPlaces.length > 0 && (
                  <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                    <span className="mb-3 block"><svg className="w-10 h-10 mx-auto text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg></span>
                    <p className="text-slate-600 font-semibold">You've saved them all!</p>
                    <p className="text-slate-400 text-sm mt-1">Try a different category or expand your search radius.</p>
                  </div>
                )}
                {loadingMore && (
                  <div className="pt-4 pb-2 flex justify-center">
                    <div className="inline-flex flex-col items-center gap-1 px-4 py-2 bg-purple-50 rounded-xl border border-purple-100">
                      <span className="text-sm font-semibold text-purple-600">Loading more places...</span>
                      <span className="text-[11px] text-purple-500">Loading more results in the background</span>
                    </div>
                  </div>
                )}
                {pagingComplete && !loadingMore && visibleExplorePlaces.length > 0 && exploreResultState === 'exhausted' && (
                  <div className="pt-6 pb-8 text-center">
                    <div className="inline-flex items-center gap-2 px-6 py-3 bg-slate-100 rounded-2xl">
                      <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      <span className="text-sm font-semibold text-slate-500">You've seen all the places nearby!</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">Try changing your search radius or category</p>
                  </div>
                )}
                {pagingComplete && !loadingMore && visibleExplorePlaces.length === 0 && exploreResultState !== 'none' && (
                  <div className="pt-6 pb-8 text-center">
                    <div className="inline-flex items-center gap-2 px-6 py-3 bg-slate-100 rounded-2xl">
                      <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      <span className="text-sm font-semibold text-slate-500">
                        {exploreResultState === 'filters_strict' ? 'Filters too strict, try relaxing.' : "You've seen all the places nearby!"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      {exploreResultState === 'filters_strict'
                        ? 'Turn off strict toggles or remove a few must-haves.'
                        : 'Try changing your search radius or category'}
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}

        {activeTab === 'favorites' && (
          <div className="space-y-4 mt-4">
            {favoritePlaces.length > 0 ? (
              favoritePlaces.map(place => {
                const details = state.favoriteDetails[place.id];
                return (
                  <PlaceCard 
                    key={place.id} 
                    place={place}
                    variant="list"
                    isFavorite={true}
                    onToggleFavorite={() => toggleFavorite(place)}
                    onClick={() => setSelectedPlace(place)}
                    showAddToGroup={canSyncCloud && circles.length > 0}
                    onAddToGroup={() => setAddToCirclePlace(place)}
                    hasNotes={!!details?.notes}
                    isVisited={!!details?.visited}
                  />
                );
              })
            ) : (
              <div className="py-24 text-center text-slate-300 font-black text-xs uppercase tracking-widest bg-white rounded-[40px] border border-slate-50">
                No saved spots yet.
              </div>
            )}
          </div>
        )}

        {addToCirclePlace && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setAddToCirclePlace(null)}>
            <div className="bg-white rounded-t-3xl w-full max-w-lg p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-lg text-slate-800">Add to Circle</h3>
              <p className="text-sm text-slate-500">Select a circle to add "{addToCirclePlace.name}":</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {circles.map(circle => {
                  return (
                    <button
                      key={circle.id}
                      onClick={() => {
                        if (!canSyncCloud) {
                          window.alert('Circle editing is disabled in read-only review mode.');
                          return;
                        }
                        const note = window.prompt('Why are we saving this?') || '';
                        saveCirclePlace(circle.id, {
                          placeId: addToCirclePlace.id,
                          savedByUid: state.user?.uid || 'guest',
                          savedByName: state.user?.displayName || state.user?.email || 'Member',
                          savedAt: new Date().toISOString(),
                          note: note.trim(),
                          placeSummary: {
                            placeId: addToCirclePlace.id,
                            name: addToCirclePlace.name,
                            imageUrl: addToCirclePlace.imageUrl,
                            type: addToCirclePlace.type,
                            mapsUrl: addToCirclePlace.mapsUrl,
                          },
                        }).catch(err => console.warn('Failed to save circle place.', err));
                        setAddToCirclePlace(null);
                      }}
                      className={`w-full p-4 rounded-xl text-left transition-colors ${
                        'bg-purple-50 hover:bg-purple-100 text-slate-700'
                      }`}
                    >
                      <span className="font-semibold">{circle.name}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setAddToCirclePlace(null)}
                className="w-full py-3 text-slate-500 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <ActivityDashboard
            isGuest={isGuest}
            visitedPlaces={state.visitedPlaces || []}
            memories={state.memories}
            savedPlaces={savedPlaces}
            userId={state.user?.uid}
            onOpenPlace={(visit) => {
              const existingPlace = savedPlaces.find(sp => sp.placeId === visit.placeId);
              if (existingPlace) {
                setSelectedPlace(mapSavedPlaceToPlace(existingPlace));
              } else {
                const fallbackImage = visit.imageUrl || 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=200&h=200&fit=crop';
                const placeFromVisit: Place = {
                  id: visit.placeId,
                  name: visit.placeName,
                  type: visit.placeType || 'all',
                  tags: [visit.placeType || 'Family'],
                  rating: 0,
                  address: '',
                  description: '',
                  priceLevel: undefined,
                  distance: '',
                  ageAppropriate: '',
                  imageUrl: fallbackImage,
                  mapsUrl: `https://www.google.com/maps/place/?q=place_id:${visit.placeId}`,
                };
                setSelectedPlace(placeFromVisit);
              }
            }}
            onGoToExplore={() => setActiveTab('explore')}
          />
        )}

        {activeTab === 'circles' && (
          <GroupsList
            circles={regularCircles}
            onCreateCircle={handleCreateCircle}
            onJoinCircle={handleJoinCircle}
            onSelectCircle={setSelectedCircle}
            isGuest={isGuest || !canSyncCloud}
            onDeleteCircle={handleDeleteCircle}
            userId={state.user?.uid}
            maxCircles={limits.circles}
          />
        )}

        {activeTab === 'memories' && (
          isGuest ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-20 h-20 bg-sky-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Sign in to save memories</h3>
              <p className="text-sm text-slate-500 max-w-xs">
                Create an account to save photos and memories from your family adventures.
              </p>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              <MemoryCreate
                entitlement={state.entitlement}
                currentCount={state.memories.length}
                places={places}
                favoritePlaces={favoritePlaces}
                onCreate={handleAddMemory}
                onUpgradePrompt={() => setShowUpgradePrompt('memories')}
                enablePartnerShare={hasLinkedPartner}
                circleOptions={circles.map(circle => ({ id: circle.id, name: circle.name }))}
                onTagCircle={handleTagMemoryToCircle}
                title="Add a Memory"
                toggleLabels={{ closed: 'Add Memory', open: 'Cancel' }}
                showToggle={true}
              />

              <div className="space-y-4">
                {[...state.memories]
                  .sort((a, b) => {
                    const dateA = a.date ? new Date(a.date).getTime() : 0;
                    const dateB = b.date ? new Date(b.date).getTime() : 0;
                    return dateB - dateA;
                  })
                  .map(memory => {
                  const photos = memory.photoThumbUrls || memory.photoUrls || (memory.photoThumbUrl ? [memory.photoThumbUrl] : (memory.photoUrl ? [memory.photoUrl] : []));
                  const memoryDate = memory.date ? new Date(memory.date) : null;
                  const timeAgo = memoryDate && !isNaN(memoryDate.getTime()) ? getTimeAgo(memoryDate) : 'Recently';
                  const dateForInput = memoryDate && !isNaN(memoryDate.getTime())
                    ? memoryDate.toISOString().split('T')[0]
                    : '';
                  
                  return (
                    <div key={memory.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                      <div className="flex items-center gap-3 p-4 pb-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                          {state.user?.displayName?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">
                            {state.user?.displayName || 'You'}
                          </p>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-400">{timeAgo}</span>
                            <span className="text-slate-300 text-xs">·</span>
                            <label className="relative inline-flex items-center cursor-pointer group">
                              <input
                                type="date"
                                value={dateForInput}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    const newDate = new Date(e.target.value + 'T12:00:00').toISOString();
                                    const updated = state.memories.map(m =>
                                      m.id === memory.id ? { ...m, date: newDate } : m
                                    );
                                    onUpdateState('memories', updated);
                                  }
                                }}
                                className="absolute inset-0 opacity-0 w-full cursor-pointer"
                              />
                              <span className="text-[11px] text-sky-500 font-medium group-active:text-sky-700">
                                {memoryDate && !isNaN(memoryDate.getTime())
                                  ? memoryDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                                  : 'Set date'}
                              </span>
                              <svg className="w-3 h-3 ml-0.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </label>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this memory?')) {
                              const updated = state.memories.filter(m => m.id !== memory.id);
                              onUpdateState('memories', updated);
                            }
                          }}
                          className="text-slate-300 hover:text-slate-500 p-1"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      
                      <div className="px-4 pb-3">
                        <p className="text-slate-800 text-sm leading-relaxed">{memory.caption}</p>
                      </div>
                      
                      {photos.length > 0 ? (
                        <div className={`${photos.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'}`}>
                          {photos.slice(0, 4).map((photo, idx) => (
                            <div key={idx} className={`relative ${photos.length === 1 ? 'aspect-video' : 'aspect-square'} bg-slate-100`}>
                              <img
                                src={photo}
                                className="w-full h-full object-cover"
                                alt=""
                                onError={(e) => {
                                  const target = e.currentTarget;
                                  if (!target.dataset.retried) {
                                    target.dataset.retried = 'true';
                                    target.src = photo + (photo.includes('?') ? '&' : '?') + 't=' + Date.now();
                                  } else {
                                    target.style.display = 'none';
                                    const parent = target.parentElement;
                                    if (parent && !parent.querySelector('.photo-fallback')) {
                                      const fallback = document.createElement('div');
                                      fallback.className = 'photo-fallback absolute inset-0 flex items-center justify-center bg-slate-100';
                                      fallback.innerHTML = '<svg class="w-8 h-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
                                      parent.appendChild(fallback);
                                    }
                                  }
                                }}
                              />
                              {idx === 3 && photos.length > 4 && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                  <span className="text-white font-bold text-lg">+{photos.length - 4}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      
                      {memory.placeName && (
                        <div className="px-4 py-3 flex items-center gap-2 border-t border-slate-100">
                          <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                          </svg>
                          <span className="text-xs font-medium text-slate-600">{memory.placeName}</span>
                        </div>
                      )}
                      
                      <div className="flex border-t border-slate-100">
                        <button
                          onClick={() => setShareMemory(memory)}
                          className="flex-1 flex items-center justify-center gap-2 py-3 text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                          <span className="text-sm font-medium">Share</span>
                        </button>
                        <div className="w-px bg-slate-100"></div>
                        <button
                          onClick={() => handleShareMemoryExternal(memory)}
                          className="flex-1 flex items-center justify-center gap-2 py-3 text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          <span className="text-sm font-medium">Share</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {activeTab === 'partner' && (
          <div className="space-y-6">
            {hasLinkedPartner ? (
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-3xl p-6 border border-rose-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-2xl shadow-sm overflow-hidden">
                    {partnerPhotoURL ? (
                      <img src={partnerPhotoURL} alt={partnerLabel} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-base font-black text-rose-500">{partnerInitial}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-slate-800">{partnerLabel}</h3>
                    {partnerEmail && (
                      <p className="text-xs text-slate-500">{partnerEmail}</p>
                    )}
                    <p className="text-xs text-slate-500">Linked {state.partnerLink?.linkedAt ? new Date(state.partnerLink.linkedAt).toLocaleDateString() : ''}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-gradient-to-br from-rose-50 to-pink-50 rounded-3xl p-6 border border-rose-100">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white text-2xl flex items-center justify-center shadow-sm"><svg className="w-6 h-6 text-rose-400" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg></div>
                    <div>
                      <h3 className="font-black text-lg text-slate-800">Partner Space</h3>
                      <p className="text-xs text-slate-500">Share favorites, memories, and quick notes together.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-100 space-y-3">
                  {isPartnerPending ? (
                    <>
                      <p className="text-sm font-semibold text-slate-700">Invite sent</p>
                      <p className="text-xs text-slate-500">Your partner hasn’t accepted yet. You can view or resend your invite code in Profile.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-700">Link your partner</p>
                      <p className="text-xs text-slate-500">Connect accounts to share places, notes, and partner circles.</p>
                    </>
                  )}

                  {isGuest ? (
                    <button
                      onClick={() => setView('login')}
                      className="w-full px-4 py-3 bg-rose-500 text-white rounded-2xl text-sm font-bold"
                    >
                      Sign in to link partner
                    </button>
                  ) : !canLinkPartner ? (
                    <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
                      <p className="text-xs font-semibold text-amber-700">Partner linking is a Pro feature.</p>
                      <button
                        onClick={() => setShowPlanBilling(true)}
                        className="mt-3 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold"
                      >
                        Upgrade to Pro
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setView('profile')}
                      className="w-full px-4 py-3 bg-rose-500 text-white rounded-2xl text-sm font-bold"
                    >
                      Link partner
                    </button>
                  )}
                </div>
              </div>
            )}

            {hasLinkedPartner && (
              <>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Shared Favorites</h4>
                    {!isPaid && state.partnerSharedPlaces.length > 3 && (
                      <span className="text-[9px] font-bold text-amber-500">Free: 3 of {state.partnerSharedPlaces.length}</span>
                    )}
                  </div>
                  {state.partnerSharedPlaces.length > 0 ? (
                    <div className="space-y-3">
                      {state.partnerSharedPlaces.slice(0, isPaid ? undefined : 3).map((shared) => {
                        const placeFromList = places.find(p => p.id === shared.placeId) ||
                          favoritePlaces.find(p => p.id === shared.placeId);
                        const fallbackImage = shared.imageUrl || 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=200&h=200&fit=crop';
                        const resolvedPlace: Place = placeFromList || {
                          id: shared.placeId,
                          name: shared.placeName,
                          description: 'Family-friendly place',
                          address: '',
                          rating: undefined,
                          tags: [],
                          imageUrl: fallbackImage,
                          mapsUrl: `https://www.google.com/maps/place/?q=place_id:${shared.placeId}`,
                          type: shared.placeType || 'all',
                        };
                        return (
                          <button
                            key={shared.placeId}
                            onClick={() => setSelectedPlace(resolvedPlace)}
                            className="w-full text-left bg-white rounded-2xl p-4 border border-slate-100 flex items-center gap-4 hover:bg-slate-50"
                          >
                            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-slate-100">
                              <img src={resolvedPlace.imageUrl} className="w-full h-full object-cover" alt="" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-slate-800 truncate">{shared.placeName}</p>
                              {shared.note && (
                                <p className="text-xs text-slate-500 line-clamp-2 mt-1">{shared.note}</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-2xl p-6 text-center">
                      <p className="text-sm text-slate-500">No shared favorites yet</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Shared Memories</h4>
                    {!isPaid && partnerSharedMemories.length > 3 && (
                      <span className="text-[9px] font-bold text-amber-500">Free: 3 of {partnerSharedMemories.length}</span>
                    )}
                  </div>
                  {partnerSharedMemories.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {partnerSharedMemories.slice(0, isPaid ? undefined : 3).map((memory) => {
                      const photos = memory.photoThumbUrls || memory.photoUrls || (memory.photoThumbUrl ? [memory.photoThumbUrl] : (memory.photoUrl ? [memory.photoUrl] : []));
                      const mainPhoto = photos[0] || memory.photoThumbUrl || memory.photoUrl;
                        return (
                          <div key={memory.id} className="aspect-square rounded-xl overflow-hidden">
                            {mainPhoto ? (
                              <img src={mainPhoto} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400 text-[10px] font-bold">
                                Text
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-2xl p-6 text-center">
                      <p className="text-sm text-slate-500">No shared memories yet</p>
                    </div>
                  )}
                </div>
            
                {!isPaid && (state.favorites.length > 3 || state.memories.length > 3) && (
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      <div>
                        <p className="font-bold text-sm text-amber-800">Upgrade to Pro</p>
                        <p className="text-xs text-amber-600">Unlimited shared favorites, memories & notes</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Partner Circles</h4>
                  <p className="text-xs text-slate-500 -mt-2">Create themed collections to share with your partner</p>
                  
                  {partnerCircles.length > 0 ? (
                    <div className="space-y-3">
                      {partnerCircles.map((circle) => (
                        <button
                          key={circle.id}
                          onClick={() => setSelectedCircle(circle)}
                          className="w-full text-left bg-white rounded-2xl p-4 border border-slate-100 flex items-center justify-between hover:bg-slate-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center text-lg"><svg className="w-5 h-5 text-rose-400" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg></div>
                            <div>
                              <p className="font-bold text-sm text-slate-800">{circle.name}</p>
                              <p className="text-xs text-slate-500">Shared with {partnerLabel}</p>
                            </div>
                          </div>
                          <span className="text-slate-300">›</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-2xl p-6 text-center">
                      <p className="text-sm text-slate-500">No partner circles yet</p>
                      <p className="text-xs text-slate-400 mt-1">Create one below to start collecting places together</p>
                    </div>
                  )}
                  
                  <div className="bg-white rounded-2xl p-4 border border-slate-100">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g., Date Night, Weekend Getaways..."
                        value={newPartnerCircleName}
                        onChange={(e) => setNewPartnerCircleName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreatePartnerCircle()}
                        className="flex-1 text-sm outline-none text-slate-700 placeholder-slate-300"
                      />
                      <button
                        onClick={handleCreatePartnerCircle}
                        disabled={creatingPartnerCircle || !newPartnerCircleName.trim()}
                        className="px-4 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold disabled:opacity-60"
                      >
                        {creatingPartnerCircle ? '...' : 'Create'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Quick Notes</h4>
                  <div className="bg-white rounded-2xl p-4 border border-slate-100">
                    {noteError && (
                      <p className="text-xs text-rose-500 mb-2">{noteError}</p>
                    )}
                    {partnerNotes.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {partnerNotes.map(note => (
                          <div key={note.id} className="bg-slate-50 rounded-xl px-3 py-2">
                            <p className="text-xs text-slate-600">{note.text}</p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {note.createdByName} · {new Date(note.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 mb-3">No notes yet.</p>
                    )}
                    <textarea 
                      placeholder="Leave a note for your partner..."
                      className="w-full h-20 text-sm resize-none outline-none text-slate-700 placeholder-slate-300"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleSendPartnerNote}
                        disabled={noteSending}
                        className="px-4 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold disabled:opacity-60"
                      >
                        {noteSending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </div>
      )}

      <MustHavesSheet
        isOpen={showMustHavesSheet}
        onClose={() => setShowMustHavesSheet(false)}
        title="Must haves"
        filters={exploreFilters}
        lensDefinitions={lensDefinitions}
        onToggleChip={toggleLensChip}
        onToggleStrict={toggleLensStrict}
        onClear={clearExploreFilters}
      />

      {showPlanBilling && (
        <PlanBilling 
          state={state} 
          onClose={() => setShowPlanBilling(false)} 
          onUpdateState={onUpdateState}
        />
      )}
      
      {showUpgradePrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setShowUpgradePrompt(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <UpgradePrompt 
              feature={showUpgradePrompt === 'savedPlaces' ? 'saved places' : showUpgradePrompt === 'circles' ? 'circles' : 'memories'}
              currentLimit={showUpgradePrompt === 'savedPlaces' ? limits.savedPlaces : showUpgradePrompt === 'circles' ? limits.circles : limits.memories}
              onUpgrade={() => {
                setShowUpgradePrompt(null);
                setShowPlanBilling(true);
              }}
            />
            <button 
              onClick={() => setShowUpgradePrompt(null)}
              className="w-full mt-4 py-2 text-slate-500 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      {shareMemory && (
        <ShareMemoryModal
          memory={shareMemory}
          circles={circles}
          onShareToCircle={(memory, circleId) => {
            const { id, ...payload } = memory;
            handleTagMemoryToCircle(circleId, payload);
          }}
          hasLinkedPartner={hasLinkedPartner}
          partnerName={partnerName || undefined}
          onShareToPartner={hasLinkedPartner ? async (memory) => {
            if (!db || !state.user?.uid || !partnerUserId) return;
            const threadId = getPartnerThreadId(state.user.uid, partnerUserId);
            const sharedRef = doc(db, 'partnerThreads', threadId, 'sharedMemories', memory.id);
            await setDoc(sharedRef, {
              ...memory,
              sharedAt: Timestamp.now(),
              sharedBy: state.user.uid,
              sharedWithPartner: true,
            }).catch((err) => console.warn('Failed to share memory with partner.', err));
          } : undefined}
          onClose={() => setShareMemory(null)}
        />
      )}

      {shareStatus && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
          <div className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-full shadow-lg shadow-slate-900/30">
            {shareStatus}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
