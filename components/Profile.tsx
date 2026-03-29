import React, { useState, useEffect } from 'react';
import { AppState, Child, Preferences, UserAccessibilityNeeds, FOOD_PREFERENCES, ALLERGY_OPTIONS, ACCESSIBILITY_OPTIONS, ACTIVITY_PREFERENCES, PLAN_LIMITS } from '../types';
import PlanBilling from './PlanBilling';
import { getLimits, getPlanDisplayName, canUseAI, isPaidTier } from '../lib/entitlements';
import { storage, auth, ref, uploadBytes, getDownloadURL, writeBatch } from '../lib/firebase';
import type { AppAccessContext } from '../lib/access';
import { googleProvider, signOut as firebaseSignOut } from '../lib/firebase';
import { reauthenticateWithRedirect } from '../lib/firebase';
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
const DELETE_REAUTH_PENDING_KEY = 'fampal_delete_reauth_pending';

interface ProfileProps {
  state: AppState;
  isGuest: boolean;
  accessContext?: AppAccessContext;
  onSignOut: () => void;
  setView: (view: string) => void;
  onUpdateState: (key: keyof AppState, value: any) => void;
  onResetOnboarding?: () => void;
}

const Profile: React.FC<ProfileProps> = ({ state, isGuest, accessContext, onSignOut, setView, onUpdateState, onResetOnboarding }) => {
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [showPreferences, setShowPreferences] = useState(false);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [showPlanBilling, setShowPlanBilling] = useState(false);
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


  const shareApp = async () => {
    const shareData = {
      title: 'FamPals',
      text: 'Check out FamPals for finding the best kid-friendly spots!',
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
      const fileName = `profile_pictures/${state.user?.uid}/avatar_${Date.now()}`;
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
    const authUser = currentUser;
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
        console.log(`[FamPal Delete] ${message}`, details);
      } else {
        console.log(`[FamPal Delete] ${message}`);
      }
    };

    try {
      devLog('Starting Firestore deletion');
      await deleteUserOwnedFirestoreData(authUser.uid, { onLog: devLog });
      devLog('Firestore deletion complete');

      // Delete account on server (JWT auth — no Firebase Auth delete needed)
      const token = localStorage.getItem('fampal_auth_token');
      if (token) {
        await fetch(`${API_BASE}/api/user/me`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      devLog('Server account deletion requested');

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
        console.warn('[FamPal Delete] Account deletion failed', err);
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
        console.log('[FamPal Delete] Re-auth using redirect flow');
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DELETE_REAUTH_PENDING_KEY, '1');
      }
      await reauthenticateWithRedirect(auth.currentUser, googleProvider);
    } catch (err: any) {
      setDeleteError(err?.message || 'Re-authentication failed. Please try again.');
      if (import.meta.env.DEV) {
        console.warn('[FamPal Delete] Re-authentication failed', err);
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
              const current = localStorage.getItem('fampal_netflix_layout') === 'true';
              localStorage.setItem('fampal_netflix_layout', current ? 'false' : 'true');
              window.location.reload();
            }}
            className="w-full flex items-center justify-between p-6 text-slate-500 font-semibold text-sm hover:bg-purple-50 hover:text-purple-600 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
              <span>Discovery Mode</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-bold ${
              localStorage.getItem('fampal_netflix_layout') === 'true'
                ? 'text-purple-600 bg-purple-50'
                : 'text-slate-400 bg-slate-100'
            }`}>
              {localStorage.getItem('fampal_netflix_layout') === 'true' ? 'On' : 'Off'}
            </span>
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
                This permanently deletes your account sign-in and your cloud-synced FamPals data.
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
              Your profile and saved places are stored in Firebase. Use the Data & Privacy section to selectively delete data, or Delete Account to remove everything.
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
