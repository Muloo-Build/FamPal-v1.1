import React, { useState, useEffect } from 'react';
import { AppState, Child, Pet, PetType, PartnerLink, Preferences, UserAccessibilityNeeds, FOOD_PREFERENCES, ALLERGY_OPTIONS, ACCESSIBILITY_OPTIONS, ACTIVITY_PREFERENCES, PET_TYPE_OPTIONS, PLAN_LIMITS } from '../types';
import PlanBilling from './PlanBilling';
import ExplorerLevel from './ExplorerLevel';
import { getLimits, getPlanDisplayName, canUseAI, isPaidTier } from '../lib/entitlements';
import { storage, auth, ref, uploadBytes, getDownloadURL, writeBatch } from '../lib/firebase';
import type { AppAccessContext } from '../lib/access';
import { googleProvider, signOut as firebaseSignOut } from '../lib/firebase';
import { reauthenticateWithRedirect } from 'firebase/auth';
import {
  clearLocalAppState,
  deleteUserOwnedFirestoreData,
  getCurrentAuthUser,
  hasRecentLogin,
  isDeleteBlockedByBypass,
} from '../lib/accountDeletion';
import ManageMyData from '../src/components/ManageMyData';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
const DELETE_CONFIRM_TEXT = 'DELETE';
const DELETE_REAUTH_PENDING_KEY = 'fampals_delete_reauth_pending';

interface ProfileProps {
  state: AppState;
  isGuest: boolean;
  accessContext?: AppAccessContext;
  onSignOut: () => void;
  setView: (view: string) => void;
  onUpdateState: (key: keyof AppState, value: any) => void;
  onResetOnboarding?: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

const generateInviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const Profile: React.FC<ProfileProps> = ({ state, isGuest, accessContext, onSignOut, setView, onUpdateState, onResetOnboarding, darkMode, onToggleDarkMode }) => {
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [petName, setPetName] = useState('');
  const [petType, setPetType] = useState<PetType>('dog');
  const [spouseEmail, setSpouseEmail] = useState('');
  const [partnerCode, setPartnerCode] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [showPlanBilling, setShowPlanBilling] = useState(false);
  const [showAdminCode, setShowAdminCode] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminTapCount, setAdminTapCount] = useState(0);
  const [uploadingProfilePic, setUploadingProfilePic] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [showManageData, setShowManageData] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [requiresReauthForDelete, setRequiresReauthForDelete] = useState(false);
  const [reauthInProgress, setReauthInProgress] = useState(false);
  const profilePicInputRef = React.useRef<HTMLInputElement>(null);
  const [profileDisplayName, setProfileDisplayName] = useState(state.profileInfo?.displayName || state.user?.displayName || '');
  const [profileAgeInput, setProfileAgeInput] = useState(
    state.profileInfo?.age ? String(state.profileInfo.age) : ''
  );

  useEffect(() => {
    setProfileDisplayName(state.profileInfo?.displayName || state.user?.displayName || '');
    setProfileAgeInput(state.profileInfo?.age ? String(state.profileInfo.age) : '');
  }, [state.profileInfo, state.user?.displayName]);

  const userPrefs = state.preferences || { foodPreferences: [], allergies: [], accessibility: [], activityPreferences: [] };
  const accessibilityNeeds: UserAccessibilityNeeds = state.accessibilityNeeds || {
    usesWheelchair: false,
    needsStepFree: false,
    needsAccessibleToilet: false,
    prefersPavedPaths: false,
    usesPushchair: false,
  };
  const effectiveEntitlement = accessContext?.entitlement ?? state.entitlement;
  const limits = accessContext?.limits ?? getLimits(effectiveEntitlement);
  const isPaid = accessContext?.isPro ?? isPaidTier(effectiveEntitlement);
  const canSyncCloud = accessContext?.canSyncCloud ?? !isGuest;
  const isLoggedIn = accessContext?.isLoggedIn ?? !!state.user;
  const isAuthBypass = accessContext?.isAuthBypass ?? isDeleteBlockedByBypass();
  const partnerLinkRequiresPro = import.meta.env.VITE_PARTNER_LINK_REQUIRES_PRO === 'true';
  const canLinkPartner = !partnerLinkRequiresPro || isPaidTier(effectiveEntitlement);
  const aiInfo = canUseAI(effectiveEntitlement, state.familyPool);
  const planTier = effectiveEntitlement?.subscription_tier === 'admin'
    ? 'pro'
    : (effectiveEntitlement?.subscription_tier === 'pro' ? 'pro' : (effectiveEntitlement?.plan_tier || 'free'));
  const appVersion = __APP_VERSION__;

  const FREE_PREF_LIMIT = limits.preferencesPerCategory;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(DELETE_REAUTH_PENDING_KEY) === '1') {
      window.sessionStorage.removeItem(DELETE_REAUTH_PENDING_KEY);
      const currentUser = getCurrentAuthUser();
      if (currentUser && hasRecentLogin(currentUser)) {
        setRequiresReauthForDelete(false);
        setDeleteError(null);
        setDeleteSuccess('Re-authentication complete. Confirm deletion to continue.');
      }
    }
  }, []);
  
  const toggleUserPref = (category: keyof Preferences, value: string) => {
    const current = userPrefs[category] as string[] || [];
    const isRemoving = current.includes(value);
    
    // Check if free user is at limit when adding
    if (!isRemoving && !isPaid && current.length >= FREE_PREF_LIMIT) {
      return; // Don't add more if at limit for free users
    }
    
    const updated = isRemoving 
      ? current.filter(v => v !== value)
      : [...current, value];
    onUpdateState('preferences', { ...userPrefs, [category]: updated });
  };

  const toggleChildPref = (childId: string, category: keyof Preferences, value: string) => {
    const children = state.children.map(c => {
      if (c.id !== childId) return c;
      const prefs = c.preferences || { foodPreferences: [], allergies: [], accessibility: [], activityPreferences: [] };
      const current = prefs[category] as string[] || [];
      const isRemoving = current.includes(value);
      
      // Check if free user is at limit when adding
      if (!isRemoving && !isPaid && current.length >= FREE_PREF_LIMIT) {
        return c; // Don't modify if at limit for free users
      }
      
      const updated = isRemoving ? current.filter(v => v !== value) : [...current, value];
      return { ...c, preferences: { ...prefs, [category]: updated } };
    });
    onUpdateState('children', children);
  };

  const toggleAccessibilityNeed = (key: keyof UserAccessibilityNeeds) => {
    onUpdateState('accessibilityNeeds', {
      ...accessibilityNeeds,
      [key]: !accessibilityNeeds[key],
    });
  };

  const handleAddChild = () => {
    if (!childName || !childAge) return;
    const newChild: Child = { id: Date.now().toString(), name: childName, age: parseInt(childAge) };
    onUpdateState('children', [...state.children, newChild]);
    setChildName('');
    setChildAge('');
  };

  const handleRemoveChild = (id: string) => {
    onUpdateState('children', state.children.filter(c => c.id !== id));
  };

  const handleAddPet = () => {
    if (!petName.trim()) return;
    const newPet: Pet = { id: Date.now().toString(), name: petName.trim(), type: petType };
    onUpdateState('pets', [...(state.pets || []), newPet]);
    setPetName('');
    setPetType('dog');
  };

  const handleRemovePet = (id: string) => {
    onUpdateState('pets', (state.pets || []).filter(p => p.id !== id));
  };

  const handleGenerateCode = () => {
    if (!canLinkPartner) {
      setShowPlanBilling(true);
      return;
    }
    const code = generateInviteCode();
    const partnerLink: PartnerLink = {
      inviteCode: code,
      linkedAt: new Date().toISOString(),
      status: 'pending'
    };
    onUpdateState('partnerLink', partnerLink);
  };

  const handleCopyCode = async () => {
    if (state.partnerLink?.inviteCode) {
      await navigator.clipboard.writeText(state.partnerLink.inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  const handleShareCode = () => {
    if (state.partnerLink?.inviteCode) {
      const message = `Join me on FamPals! Use my partner code: ${state.partnerLink.inviteCode}\n\nDownload the app: ${window.location.origin}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
    }
  };

  const handleAdminCode = async () => {
    if (!import.meta.env.DEV) {
      alert('Admin code is disabled in production builds.');
      return;
    }
    const ADMIN_CODE = 'FAMPRO2026';
    if (adminCode.toUpperCase() === ADMIN_CODE) {
      if (!auth?.currentUser) {
        alert('Please sign in first.');
        return;
      }
      try {
        const now = new Date();
        const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const proEntitlement = {
          subscription_tier: 'pro',
          subscription_status: 'active',
          subscription_source: 'admin',
          gemini_credits_used: 0,
          gemini_credits_limit: 100,
          usage_reset_month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          plan_tier: 'pro',
          plan_status: 'active',
          entitlement_source: 'admin',
          entitlement_start_date: now.toISOString(),
          entitlement_end_date: null,
          ai_requests_this_month: 0,
          ai_requests_reset_date: resetDate.toISOString(),
        };
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE}/api/dev/grant-pro`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({ entitlement: proEntitlement }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to apply admin code');
        }
        onUpdateState('entitlement', proEntitlement);
        setAdminCode('');
        setShowAdminCode(false);
        alert('Pro features activated! You now have full access to test all features.');
      } catch (err) {
        console.error('Failed to apply admin code', err);
        alert('Failed to apply code. Please try again.');
      }
    } else {
      alert('Invalid code. Please try again.');
    }
  };

  const handleVersionTap = () => {
    setAdminTapCount(prev => {
      const newCount = prev + 1;
      if (newCount >= 5) {
        setShowAdminCode(true);
        return 0;
      }
      return newCount;
    });
  };

  const handleJoinWithCode = async () => {
    if (!canSyncCloud) {
      alert('Partner linking is disabled in read-only review mode.');
      return;
    }
    if (!canLinkPartner) {
      alert('Partner linking is available on Pro or Family plans.');
      setShowPlanBilling(true);
      return;
    }
    if (!partnerCode || partnerCode.length !== 6) {
      alert('Please enter a valid 6-character code.');
      return;
    }
    if (!auth?.currentUser) {
      alert('Please sign in to link with a partner.');
      return;
    }

    const normalizedCode = partnerCode.toUpperCase();
    try {
      const idToken = await auth.currentUser.getIdToken();
      const selfProfileName = state.user?.displayName || state.user?.email || 'Partner';
      const response = await fetch(`${API_BASE}/api/partner/link`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ 
          inviteCode: normalizedCode,
          selfName: selfProfileName,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to link');
      }

      const partnerLink = data.partnerLink || undefined;
      onUpdateState('partnerLink', partnerLink);
      setPartnerCode('');
      setShowCodeInput(false);
      alert(`Successfully linked with ${partnerLink?.partnerName || 'your partner'}! The Partner tab is now available.`);
    } catch (err: any) {
      console.warn('[FamPals] Partner lookup failed:', err);
      alert(err?.message || 'Failed to find partner. Please try again.');
    }
  };

  const handleUnlinkPartner = async () => {
    if (!canSyncCloud) {
      onUpdateState('partnerLink', undefined);
      onUpdateState('spouseName', undefined);
      onUpdateState('linkedEmail', undefined);
      return;
    }
    if (!auth?.currentUser?.uid) {
      onUpdateState('partnerLink', undefined);
      onUpdateState('spouseName', undefined);
      onUpdateState('linkedEmail', undefined);
      return;
    }
    const uid = auth.currentUser.uid;
    const partnerUserId = state.partnerLink?.partnerUserId;
    
    // If no partner linked yet (pending code), clear it through the shared user-data path.
    if (!partnerUserId) {
      try {
        await saveUserField(uid, 'partnerLink', undefined);
        onUpdateState('partnerLink', undefined);
        onUpdateState('spouseName', undefined);
        onUpdateState('linkedEmail', undefined);
      } catch (err) {
        console.warn('Failed to clear pending code.', err);
        // Still clear local state
        onUpdateState('partnerLink', undefined);
        onUpdateState('spouseName', undefined);
        onUpdateState('linkedEmail', undefined);
      }
      return;
    }
    
    // Use backend API to unlink both users (bypasses Firestore rules)
    try {
      console.log('[FamPals] Unlinking partner via API');
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Not authenticated');
      }
      
      const response = await fetch(`${API_BASE}/api/partner/unlink`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({}), // No partnerUserId needed - server derives from user doc
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to unlink');
      }
      
      console.log('[FamPals] Partner unlink successful via API');
      onUpdateState('partnerLink', undefined);
      onUpdateState('spouseName', undefined);
      onUpdateState('linkedEmail', undefined);
      alert('Partner link removed successfully.');
    } catch (err: any) {
      console.warn('[FamPals] Failed to unlink partner:', err);
      alert('Unable to unlink right now. Please try again.');
    }
  };
  
  const refreshPartnerStatus = async () => {
    if (!canSyncCloud) {
      alert('Partner refresh is disabled in read-only review mode.');
      return;
    }
    if (!auth?.currentUser) {
      return;
    }
    try {
      console.log('[FamPals] Refreshing partner status via API');
      const idToken = await auth.currentUser.getIdToken();
      
      const response = await fetch(`${API_BASE}/api/partner/status`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch partner status');
      }
      
      const data = await response.json();
      const partnerLink = data.partnerLink || undefined;
      console.log('[FamPals] Refreshed partnerLink:', partnerLink);
      onUpdateState('partnerLink', partnerLink);
      alert('Partner status refreshed!');
    } catch (err: any) {
      console.warn('[FamPals] Failed to refresh partner status:', err);
      alert('Unable to refresh partner status. Please try again.');
    }
  };

  const shareApp = async () => {
    const shareData = {
      title: 'FamPals',
      text: 'Check out FamPals for finding the best kid and pet-friendly spots!',
      url: window.location.origin,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareData.text + ' ' + shareData.url)}`, '_blank');
      }
    } catch (err) {
      console.log('Share failed', err);
    }
  };

  const userName = state.profileInfo?.displayName || state.user?.displayName || 'Guest User';
  const userPhoto = state.user?.photoURL || 'https://picsum.photos/seed/guest/200';
  
  const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canSyncCloud) {
      alert('Profile photo uploads are disabled in read-only review mode.');
      return;
    }
    const file = e.target.files?.[0];
    if (!file || !storage || !auth?.currentUser) return;
    
    if (file.size > 5 * 1024 * 1024) {
      alert('Photo must be under 5MB');
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    
    setUploadingProfilePic(true);
    try {
      const fileName = `profile_pictures/${auth.currentUser.uid}/avatar_${Date.now()}`;
      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      
      // Update user state with new photo URL
      if (state.user) {
        onUpdateState('user', { ...state.user, photoURL: downloadUrl });
      }
    } catch (error) {
      console.error('Profile picture upload failed:', error);
      alert('Failed to upload photo. Please try again.');
    }
    setUploadingProfilePic(false);
    if (profilePicInputRef.current) profilePicInputRef.current.value = '';
  };

  const handleSaveProfileInfo = () => {
    if (isGuest) {
      setView('login');
      return;
    }
    const trimmedName = profileDisplayName.trim();
    const parsedAge = profileAgeInput.trim() ? Number(profileAgeInput) : NaN;
    const payload = {
      ...(state.profileInfo || {}),
      displayName: trimmedName || undefined,
      age: Number.isFinite(parsedAge) ? parsedAge : undefined,
    };
    onUpdateState('profileInfo', payload);
  };

  const handleDeleteAccount = async () => {
    if (!isLoggedIn || isGuest || isAuthBypass || !canSyncCloud) {
      setDeleteError('Account deletion is unavailable in the current mode.');
      return;
    }
    const currentUser = getCurrentAuthUser();
    if (!currentUser) {
      setDeleteError('You need to be signed in to delete your account.');
      return;
    }
    if (deleteConfirmInput.trim().toUpperCase() !== DELETE_CONFIRM_TEXT) {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }
    const authUser = auth?.currentUser;
    if (!authUser || !hasRecentLogin(authUser)) {
      setRequiresReauthForDelete(true);
      setDeleteError('For security, please sign in again before deleting your account.');
      return;
    }

    setDeleteInProgress(true);
    setDeleteError(null);
    setDeleteSuccess(null);
    const devLog = (message: string, details?: unknown) => {
      if (!import.meta.env.DEV) return;
      if (details !== undefined) {
        console.log(`[FamPals Delete] ${message}`, details);
      } else {
        console.log(`[FamPals Delete] ${message}`);
      }
    };

    try {
      devLog('Starting Firestore deletion');
      await deleteUserOwnedFirestoreData(authUser.uid, { onLog: devLog });
      devLog('Firestore deletion complete');

      await authUser.delete();
      devLog('Firebase Auth user deleted');

      await firebaseSignOut(auth).catch(() => {});
      clearLocalAppState();
      setDeleteSuccess('Your account and synced data were deleted successfully.');
      window.alert('Your account was deleted successfully.');
      setShowDeleteAccountConfirm(false);
      setDeleteConfirmInput('');
      setView('login');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/requires-recent-login') {
        setRequiresReauthForDelete(true);
        setDeleteError('Please sign in again, then retry account deletion.');
      } else {
        setDeleteError('Failed to delete your account. Please try again.');
      }
      if (import.meta.env.DEV) {
        console.warn('[FamPals Delete] Account deletion failed', err);
      }
    } finally {
      setDeleteInProgress(false);
    }
  };

  const handleReauthenticateForDelete = async () => {
    if (isAuthBypass) {
      setDeleteError('Re-authentication is disabled in auth bypass mode.');
      return;
    }
    if (!auth?.currentUser || !googleProvider) {
      setDeleteError('Unable to start re-authentication right now.');
      return;
    }
    setReauthInProgress(true);
    setDeleteError(null);
    try {
      if (import.meta.env.DEV) {
        console.log('[FamPals Delete] Re-auth using redirect flow');
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DELETE_REAUTH_PENDING_KEY, '1');
      }
      await reauthenticateWithRedirect(auth.currentUser, googleProvider);
    } catch (err: any) {
      setDeleteError(err?.message || 'Re-authentication failed. Please try again.');
      if (import.meta.env.DEV) {
        console.warn('[FamPals Delete] Re-authentication failed', err);
      }
    } finally {
      setReauthInProgress(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 container-safe">
      <header className="px-5 pt-8 pb-4 bg-white/80 backdrop-blur-lg sticky top-0 z-50 border-b border-slate-100">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setView('dashboard')}
            className="w-10 h-10 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500"
          >
            ←
          </button>
          <h1 className="text-lg font-black text-[#1E293B]">Profile</h1>
        </div>
      </header>

      <div className="px-5 py-10 space-y-12 animate-slide-up">
        {!isGuest && !canSyncCloud && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 text-sm">
            Review mode: account-linked writes are disabled. You can browse all sections safely.
          </div>
        )}
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <input
              ref={profilePicInputRef}
              type="file"
              accept="image/*"
              onChange={handleProfilePicUpload}
              className="hidden"
            />
            <div 
              onClick={() => canSyncCloud && profilePicInputRef.current?.click()}
              className={`w-36 h-36 rounded-[56px] overflow-hidden border-8 border-white shadow-2xl shadow-slate-200 ${canSyncCloud ? 'cursor-pointer' : ''}`}
            >
              {uploadingProfilePic ? (
                <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                  <span className="text-slate-400 text-sm font-bold">Uploading...</span>
                </div>
              ) : (
                <img src={userPhoto} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
              )}
            </div>
            <button 
              onClick={() => canSyncCloud && profilePicInputRef.current?.click()}
              disabled={!canSyncCloud || uploadingProfilePic}
              className={`absolute -bottom-2 -right-2 w-12 h-12 rounded-2xl flex items-center justify-center text-white border-4 border-[#F8FAFC] shadow-lg ${
                !canSyncCloud ? 'bg-slate-300 cursor-not-allowed' : 'bg-purple-500 hover:bg-purple-600 cursor-pointer'
              }`}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
            </button>
          </div>
          <div className="text-center">
            <h2 className="text-3xl font-black text-[#1E293B]">{userName}</h2>
            <p className="text-purple-500 font-extrabold text-xs uppercase tracking-widest mt-1">Adventure Parent</p>
          </div>
        </div>

        {!isGuest && (
          <div className="bg-white rounded-[32px] p-6 border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Profile Basics</h3>
              <button
                onClick={handleSaveProfileInfo}
                className="text-xs font-bold text-sky-600"
              >
                Save
              </button>
            </div>
            <div className="space-y-3">
              <input
                value={profileDisplayName}
                onChange={(e) => setProfileDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full h-12 rounded-2xl bg-slate-50 border border-slate-100 px-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-sky-200"
              />
              <input
                value={profileAgeInput}
                onChange={(e) => setProfileAgeInput(e.target.value)}
                placeholder="Age"
                type="number"
                min="0"
                className="w-full h-12 rounded-2xl bg-slate-50 border border-slate-100 px-4 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
            <p className="text-[11px] text-slate-400">These details help personalize your recommendations.</p>
          </div>
        )}

        <div className="bg-gradient-to-br from-sky-500 to-blue-600 rounded-[40px] p-8 text-white shadow-xl shadow-sky-200 space-y-4">
          <h3 className="text-lg font-black leading-tight">Spread the Adventure</h3>
          <p className="text-white/80 text-xs font-bold leading-relaxed">Know another parent who needs better weekend plans? Share FamPals with your group chat.</p>
          <button 
            onClick={shareApp}
            className="w-full h-14 bg-white text-sky-600 rounded-2xl font-black text-xs uppercase tracking-widest active-press shadow-lg"
          >
            Share with Friends
          </button>
        </div>

        <div className="space-y-6">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Your Family</h3>
          
          <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-2xl p-4 border border-purple-100">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-purple-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              <div>
                <p className="text-sm font-bold text-purple-800">Better recommendations for your family</p>
                <p className="text-xs text-purple-600 mt-1">
                  Add your children's ages below to get personalized smart insights and place recommendations tailored to your family's needs.
                </p>
              </div>
            </div>
          </div>

          {isGuest ? (
            <button 
              onClick={() => setView('login')}
              className="w-full bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm hover:shadow-md hover:border-sky-200 transition-all"
            >
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                  <svg className="w-8 h-8 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-700 mb-2">Sign in to save your family</h3>
                <p className="text-sm text-slate-500 max-w-xs mx-auto">
                  Create an account to save your children's details and get personalized recommendations.
                </p>
                <p className="text-purple-500 font-semibold text-sm mt-4">Tap to sign in →</p>
              </div>
            </button>
          ) : (
            <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm space-y-6">
              <div className="space-y-3">
                {state.children.map(child => {
                  const childPrefs = child.preferences || { foodPreferences: [], allergies: [], accessibility: [], activityPreferences: [] };
                  const prefsCount = childPrefs.foodPreferences.length + childPrefs.allergies.length + childPrefs.accessibility.length + childPrefs.activityPreferences.length;
                  return (
                    <div key={child.id} className="bg-slate-50 rounded-2xl border border-slate-100/50 overflow-hidden">
                      <div className="flex justify-between items-center p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-sky-400">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                          </div>
                          <div>
                            <p className="font-black text-sm text-[#1E293B]">{child.name}</p>
                            <p className="text-[9px] text-purple-500 font-black uppercase tracking-widest">Age {child.age}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setEditingChildId(editingChildId === child.id ? null : child.id)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-bold ${prefsCount > 0 ? 'bg-violet-100 text-violet-600' : 'bg-slate-200 text-slate-500'}`}
                          >
                            {prefsCount || '+'} prefs
                          </button>
                          <button onClick={() => handleRemoveChild(child.id)} className="text-slate-300 font-black text-[10px] uppercase hover:text-rose-500 transition-colors">×</button>
                        </div>
                      </div>

                      {editingChildId === child.id && (
                        <div className="px-4 pb-4 space-y-4 border-t border-slate-200 pt-3 bg-white">
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Food</p>
                            <div className="flex flex-wrap gap-1.5">
                              {FOOD_PREFERENCES.map(pref => (
                                <button
                                  key={pref}
                                  onClick={() => toggleChildPref(child.id, 'foodPreferences', pref)}
                                  className={`px-2 py-1 rounded-lg text-[9px] font-bold ${
                                    childPrefs.foodPreferences.includes(pref) ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Allergies</p>
                            <div className="flex flex-wrap gap-1.5">
                              {ALLERGY_OPTIONS.map(pref => (
                                <button
                                  key={pref}
                                  onClick={() => toggleChildPref(child.id, 'allergies', pref)}
                                  className={`px-2 py-1 rounded-lg text-[9px] font-bold ${
                                    childPrefs.allergies.includes(pref) ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Accessibility</p>
                            <div className="flex flex-wrap gap-1.5">
                              {ACCESSIBILITY_OPTIONS.map(pref => (
                                <button
                                  key={pref}
                                  onClick={() => toggleChildPref(child.id, 'accessibility', pref)}
                                  className={`px-2 py-1 rounded-lg text-[9px] font-bold ${
                                    childPrefs.accessibility.includes(pref) ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Activities</p>
                            <div className="flex flex-wrap gap-1.5">
                              {ACTIVITY_PREFERENCES.map(pref => (
                                <button
                                  key={pref}
                                  onClick={() => toggleChildPref(child.id, 'activityPreferences', pref)}
                                  className={`px-2 py-1 rounded-lg text-[9px] font-bold ${
                                    childPrefs.activityPreferences.includes(pref) ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {pref}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddChild();
                }}
                className="space-y-3"
              >
                <div className="flex gap-3">
                  <input 
                    placeholder="Child's Name" 
                    className="flex-1 h-14 bg-slate-50 border-none rounded-2xl px-5 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-sky-100"
                    value={childName}
                    onChange={e => setChildName(e.target.value)}
                  />
                  <input 
                    placeholder="Age" 
                    type="number"
                    className="w-24 h-14 bg-slate-50 border-none rounded-2xl px-4 text-sm font-bold text-center outline-none focus:bg-white focus:ring-2 focus:ring-sky-100"
                    value={childAge}
                    onChange={e => setChildAge(e.target.value)}
                  />
                </div>
                <button 
                  type="submit"
                  className="w-full h-12 bg-purple-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-purple-100 active-press flex items-center justify-center gap-2"
                >
                  <span>+</span> Add Child
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Pets</h3>
          {!isGuest ? (
            <div className="bg-white rounded-[40px] p-6 border border-slate-100 shadow-sm space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Add your pets to find pet-friendly spots and activities.
              </p>

              <div className="space-y-3">
                {(state.pets || []).map(pet => {
                  const typeOption = PET_TYPE_OPTIONS.find(o => o.value === pet.type);
                  return (
                    <div key={pet.id} className="bg-slate-50 rounded-2xl border border-slate-100/50 overflow-hidden">
                      <div className="flex justify-between items-center p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-lg">
                            {typeOption?.icon || '🐾'}
                          </div>
                          <div>
                            <p className="font-black text-sm text-[#1E293B]">{pet.name}</p>
                            <p className="text-[9px] text-amber-500 font-black uppercase tracking-widest">{typeOption?.label || pet.type}</p>
                          </div>
                        </div>
                        <button onClick={() => handleRemovePet(pet.id)} className="text-slate-300 font-black text-[10px] uppercase hover:text-rose-500 transition-colors">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddPet();
                }}
                className="space-y-3"
              >
                <div className="flex gap-3">
                  <input
                    placeholder="Pet's Name"
                    className="flex-1 h-14 bg-slate-50 border-none rounded-2xl px-5 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-amber-100"
                    value={petName}
                    onChange={e => setPetName(e.target.value)}
                  />
                  <select
                    value={petType}
                    onChange={e => setPetType(e.target.value as PetType)}
                    className="w-28 h-14 bg-slate-50 border-none rounded-2xl px-3 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-amber-100 appearance-none text-center"
                  >
                    {PET_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full h-12 bg-amber-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-100 active-press flex items-center justify-center gap-2"
                >
                  <span>+</span> Add Pet
                </button>
              </form>
            </div>
          ) : (
            <div className="bg-white rounded-[40px] p-6 border border-slate-100 shadow-sm text-center">
              <p className="text-xs text-slate-400">
                Create an account to save your pets' details and find pet-friendly spots.
              </p>
            </div>
          )}
        </div>

        {!isGuest && (
          <div className="space-y-6">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Your Preferences</h3>
            <div className="bg-white rounded-[40px] p-6 border border-slate-100 shadow-sm space-y-4">
              <button 
                onClick={() => setShowPreferences(!showPreferences)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center text-violet-500">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm text-slate-800">Food, Activities & Accessibility</p>
                    <p className="text-[10px] text-slate-400">
                      {(userPrefs.foodPreferences.length + userPrefs.allergies.length + userPrefs.accessibility.length + userPrefs.activityPreferences.length) || 'No'} preferences set
                    </p>
                  </div>
                </div>
                <span className={`text-slate-300 transition-transform ${showPreferences ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {showPreferences && (
                <>
                  {!isPaid && (
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-3 border border-amber-100 mb-4 mt-4">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                        <div>
                          <p className="font-bold text-xs text-amber-800">Free: 3 preferences per category</p>
                          <p className="text-[10px] text-amber-600">Upgrade to Pro for unlimited preferences</p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-5 pt-4 border-t border-slate-100">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Mobility Needs for Ranking</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'usesWheelchair', label: 'Uses wheelchair' },
                        { key: 'needsStepFree', label: 'Needs step free entry' },
                        { key: 'needsAccessibleToilet', label: 'Needs accessible toilet' },
                        { key: 'prefersPavedPaths', label: 'Prefers paved paths' },
                        { key: 'usesPushchair', label: 'Uses pushchair' },
                      ].map((need) => (
                        <button
                          key={need.key}
                          onClick={() => toggleAccessibilityNeed(need.key as keyof UserAccessibilityNeeds)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                            accessibilityNeeds[need.key as keyof UserAccessibilityNeeds]
                              ? 'bg-purple-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {need.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Food Preferences</p>
                      {!isPaid && <span className="text-[9px] font-bold text-slate-400">{userPrefs.foodPreferences.length}/{FREE_PREF_LIMIT}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {FOOD_PREFERENCES.map(pref => {
                        const isSelected = userPrefs.foodPreferences.includes(pref);
                        const isDisabled = !isSelected && !isPaid && userPrefs.foodPreferences.length >= FREE_PREF_LIMIT;
                        return (
                          <button
                            key={pref}
                            onClick={() => toggleUserPref('foodPreferences', pref)}
                            disabled={isDisabled}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                              isSelected 
                                ? 'bg-green-500 text-white' 
                                : isDisabled ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {pref}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Allergies</p>
                    <div className="flex flex-wrap gap-2">
                      {ALLERGY_OPTIONS.map(pref => (
                        <button
                          key={pref}
                          onClick={() => toggleUserPref('allergies', pref)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                            userPrefs.allergies.includes(pref) 
                              ? 'bg-rose-500 text-white' 
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {pref}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Accessibility Needs</p>
                    <div className="flex flex-wrap gap-2">
                      {ACCESSIBILITY_OPTIONS.map(pref => (
                        <button
                          key={pref}
                          onClick={() => toggleUserPref('accessibility', pref)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                            userPrefs.accessibility.includes(pref) 
                              ? 'bg-purple-500 text-white' 
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {pref}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Activity Preferences</p>
                    <div className="flex flex-wrap gap-2">
                      {ACTIVITY_PREFERENCES.map(pref => (
                        <button
                          key={pref}
                          onClick={() => toggleUserPref('activityPreferences', pref)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                            userPrefs.activityPreferences.includes(pref) 
                              ? 'bg-violet-500 text-white' 
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {pref}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                </>
              )}
            </div>
          </div>
        )}

        {!isGuest && (
          <div className="space-y-6">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Connections</h3>
            <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-sm space-y-6">
              {state.partnerLink ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-5 bg-sky-50 rounded-3xl border border-sky-100">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-rose-400">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                    </div>
                    <div className="flex-1">
                      {state.partnerLink.status === 'accepted' ? (
                        <>
                          <p className="text-sm font-black text-sky-900">{state.partnerLink.partnerName || 'Partner'}</p>
                          <p className="text-[10px] text-green-500 font-black uppercase tracking-widest">Connected</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-black text-sky-900">Your Invite Code</p>
                          <p className="text-2xl font-black text-purple-500 tracking-[0.3em] mt-1">{state.partnerLink.inviteCode}</p>
                          <p className="text-[10px] text-amber-500 font-black uppercase tracking-widest mt-1">Waiting for partner</p>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button 
                        onClick={refreshPartnerStatus}
                        className="text-sky-400 hover:text-sky-600 text-xs font-bold transition-colors"
                      >
                        Refresh
                      </button>
                      <button 
                        onClick={handleUnlinkPartner}
                        className="text-slate-300 hover:text-rose-500 text-xs font-bold transition-colors"
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                  
                  {state.partnerLink.status === 'pending' && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button 
                          onClick={handleCopyCode}
                          className="flex-1 h-12 bg-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-600 active-press"
                        >
                          {codeCopied ? '✓ Copied!' : 'Copy Code'}
                        </button>
                        <button 
                          onClick={handleShareCode}
                          className="flex-1 h-12 bg-green-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest active-press"
                        >
                          Share via WhatsApp
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 text-center">Partner connected? The app updates automatically.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500 text-center">Link with your partner to share saved places and plan adventures together.</p>
                  
                  {!canLinkPartner ? (
                    <div className="space-y-3">
                      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center">
                        <p className="text-sm font-bold text-amber-700">Partner linking is a Pro or Family feature.</p>
                        <p className="text-xs text-amber-600 mt-1">Upgrade to start sharing places and memories.</p>
                      </div>
                      <button
                        onClick={() => setShowPlanBilling(true)}
                        className="w-full h-12 bg-amber-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest active-press"
                      >
                        View Plans
                      </button>
                    </div>
                  ) : showCodeInput ? (
                    <div className="space-y-3">
                      <input 
                        placeholder="Enter 6-digit code" 
                        className="w-full h-14 bg-slate-50 border-none rounded-2xl px-5 text-lg font-black text-center uppercase tracking-[0.2em] outline-none"
                        maxLength={6}
                        value={partnerCode}
                        onChange={e => setPartnerCode(e.target.value.toUpperCase())}
                      />
                      <button 
                        onClick={handleJoinWithCode}
                        disabled={partnerCode.length !== 6}
                        className="w-full h-14 bg-purple-500 text-white rounded-2xl text-sm font-black uppercase tracking-widest active-press disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Join with Code
                      </button>
                      <button 
                        onClick={() => { setShowCodeInput(false); setPartnerCode(''); }}
                        className="w-full text-slate-400 text-sm font-medium py-2"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button 
                        onClick={handleGenerateCode}
                        className="flex-1 h-14 bg-purple-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest active-press"
                      >
                        Generate Invite Code
                      </button>
                      <button 
                        onClick={() => setShowCodeInput(true)}
                        className="flex-1 h-14 bg-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-600 active-press"
                      >
                        I Have a Code
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!isGuest && (
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Explorer Level</h3>
            <ExplorerLevel uid={state.user?.uid || undefined} />
          </div>
        )}

        {!isGuest && (
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Plan & Billing</h3>
            <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
              <button 
                onClick={() => setShowPlanBilling(true)}
                className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-xl">
                    {getPlanDisplayName(planTier) === 'Pro' ? (
                      <svg className="w-6 h-6 text-amber-500" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                    ) : (
                      <svg className="w-6 h-6 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    )}
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-slate-800">{getPlanDisplayName(planTier)} Plan</p>
                    <p className="text-xs text-slate-400">
                      {getPlanDisplayName(planTier) === 'Pro' ? 'Pro subscription' : 
                       'Upgrade for unlimited features'}
                    </p>
                  </div>
                </div>
                <span className="text-slate-400">→</span>
              </button>
            </div>
          </div>
        )}

        {showAdminCode && (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-[32px] border border-purple-200 shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-black text-purple-600 uppercase tracking-widest">Admin Access</h3>
            <input
              type="text"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
              placeholder="Enter admin code"
              className="w-full h-14 bg-white border border-purple-200 rounded-2xl px-5 text-lg font-black text-center uppercase tracking-[0.15em] outline-none focus:ring-2 focus:ring-purple-400"
              maxLength={10}
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdminCode}
                disabled={!adminCode.trim()}
                className="flex-1 h-12 bg-purple-500 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"
              >
                Activate
              </button>
              <button
                onClick={() => { setShowAdminCode(false); setAdminCode(''); }}
                className="px-4 h-12 bg-slate-100 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isGuest && onResetOnboarding && (
          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden mb-4">
            <button 
              onClick={onResetOnboarding}
              className="w-full flex items-center justify-between p-6 text-slate-500 font-semibold text-sm hover:bg-sky-50 hover:text-sky-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c0 2 4 3 6 3s6-1 6-3v-5" /></svg>
                <span>Show Onboarding Again</span>
              </div>
              <span className="text-xs text-slate-400">→</span>
            </button>
          </div>
        )}

        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          <button
            onClick={() => {
              const current = localStorage.getItem('fampals_netflix_layout') === 'true';
              localStorage.setItem('fampals_netflix_layout', current ? 'false' : 'true');
              window.location.reload();
            }}
            className="w-full flex items-center justify-between p-6 text-slate-500 font-semibold text-sm hover:bg-purple-50 hover:text-purple-600 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
              <span>Discovery Mode</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-bold ${
              localStorage.getItem('fampals_netflix_layout') === 'true'
                ? 'text-purple-600 bg-purple-50'
                : 'text-slate-400 bg-slate-100'
            }`}>
              {localStorage.getItem('fampals_netflix_layout') === 'true' ? 'On' : 'Off'}
            </span>
          </button>
        </div>

        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          <button
            onClick={onToggleDarkMode}
            className="w-full flex items-center justify-between p-6 text-slate-500 font-semibold text-sm hover:bg-purple-50 hover:text-purple-600 transition-colors"
          >
            <div className="flex items-center gap-3">
              {darkMode ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
              )}
              <span>Dark Mode</span>
            </div>
            <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
              darkMode ? 'bg-purple-500' : 'bg-slate-300'
            }`}>
              <span data-toggle-knob className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                darkMode ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>
        </div>

        {isLoggedIn && !isAuthBypass && (
          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Data & Privacy</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Manage or delete specific categories of your personal data.
              </p>
            </div>
            <button
              onClick={() => setShowManageData(true)}
              className="w-full flex items-center justify-between p-6 text-purple-600 font-black text-xs uppercase tracking-widest hover:bg-purple-50 transition-colors min-h-[52px]"
            >
              <span>Manage My Data</span>
              <span>→</span>
            </button>
          </div>
        )}

        {isLoggedIn && !isAuthBypass && (
          <div className="bg-white rounded-[32px] border border-rose-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-rose-100">
              <h3 className="text-sm font-black text-rose-700 uppercase tracking-widest">Delete Account</h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                This permanently deletes your account sign-in and your cloud-synced FamPal data.
              </p>
            </div>
            {!showDeleteAccountConfirm ? (
              <div className="p-6">
                <button
                  onClick={() => {
                    setShowDeleteAccountConfirm(true);
                    setDeleteError(null);
                    setDeleteSuccess(null);
                  }}
                  className="w-full h-11 rounded-2xl bg-rose-600 text-white text-xs font-black uppercase tracking-widest"
                >
                  Delete account permanently
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-3">
                <p className="text-xs text-slate-600">
                  Type <span className="font-black text-rose-600">DELETE</span> to confirm:
                </p>
                <input
                  value={deleteConfirmInput}
                  onChange={(e) => setDeleteConfirmInput(e.target.value)}
                  placeholder="Type DELETE"
                  className="w-full h-11 rounded-xl border border-rose-200 px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-rose-200"
                />
                {deleteError && (
                  <p className="text-xs text-rose-600 font-semibold">{deleteError}</p>
                )}
                {deleteSuccess && (
                  <p className="text-xs text-emerald-700 font-semibold">{deleteSuccess}</p>
                )}
                {requiresReauthForDelete && (
                  <button
                    onClick={handleReauthenticateForDelete}
                    disabled={reauthInProgress}
                    className="w-full h-10 rounded-xl bg-purple-500 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-60"
                  >
                    {reauthInProgress ? 'Re-authenticating...' : 'Sign in again to continue'}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowDeleteAccountConfirm(false);
                      setDeleteConfirmInput('');
                      setDeleteError(null);
                      setDeleteSuccess(null);
                      setRequiresReauthForDelete(false);
                    }}
                    className="flex-1 h-10 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wide"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteInProgress}
                    className="flex-1 h-10 rounded-xl bg-rose-600 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-60"
                  >
                    {deleteInProgress ? 'Deleting...' : 'Confirm delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
          {!isGuest && (
            <div className="px-6 pt-6 pb-2 text-xs text-slate-500 leading-relaxed border-b border-slate-100">
              Your profile, memories, and saved places are stored in Firebase. Use the Data & Privacy section to selectively delete data, or Delete Account to remove everything.
            </div>
          )}
          {!isGuest && (import.meta.env.VITE_ADMIN_UIDS || '').split(',').includes(state.user?.uid || '') && (
            <button
              onClick={() => setView('admin')}
              className="w-full flex items-center justify-between p-6 text-violet-500 font-black text-xs uppercase tracking-widest hover:bg-violet-50 transition-colors border-b border-slate-100 min-h-[52px]"
            >
              <span>Admin: Review Reports</span>
              <span>→</span>
            </button>
          )}
          <button 
            onClick={onSignOut}
            className="w-full flex items-center justify-between p-6 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-rose-50 hover:text-rose-500 transition-colors min-h-[52px]"
          >
            <span>Sign Out</span>
            <span>→</span>
          </button>
        </div>
        {!isGuest && (
          <div className="text-center py-4">
            <button
              onClick={handleVersionTap}
              className="text-xs text-slate-300 hover:text-slate-400 transition-colors"
            >
              Version {appVersion}
            </button>
          </div>
        )}
      </div>

      {showManageData && (
        <div className="fixed inset-0 z-50 bg-slate-50">
          <ManageMyData onBack={() => setShowManageData(false)} />
        </div>
      )}
      {showPlanBilling && (
        <PlanBilling 
          state={state} 
          onClose={() => setShowPlanBilling(false)} 
          onUpdateState={onUpdateState}
        />
      )}
    </div>
  );
};

export default Profile;
