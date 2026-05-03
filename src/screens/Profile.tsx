import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, LogOut, ChevronRight, MapPin,
  Heart, Star, Shield, Share2, Clock, Trash2,
} from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { SavedPlace } from '../../types';
import { listenToSavedPlaces } from '../../lib/userData';
import { getRecentlyViewed, clearRecentlyViewed, type RecentlyViewedItem } from '../../lib/recentlyViewed';
import BottomNav from '../components/BottomNav';

interface Props {
  user: AuthUser | null;
  isGuest: boolean;
  onSignOut: () => void;
}

export default function ProfileScreen({ user, isGuest, onSignOut }: Props) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setRecentlyViewed(getRecentlyViewed());
  }, []);

  useEffect(() => {
    if (!user) return;
    return listenToSavedPlaces(user.uid, setSavedPlaces);
  }, [user]);

  const handleSignOut = () => {
    if (isGuest) { onSignOut(); return; }
    setShowConfirm(true);
  };

  const confirmSignOut = () => { setShowConfirm(false); onSignOut(); };

  const handleShare = async () => {
    const url = window.location.origin;
    const text = 'Discover family-friendly places near you with FamPals!';
    if (navigator.share) {
      await navigator.share({ title: 'FamPals', text, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`).catch(() => {});
    }
  };

  const avatarUrl = user?.photoURL;
  const displayName = user?.displayName || (isGuest ? 'Guest' : 'FamPal User');
  const email = user?.email;

  const savedCount = savedPlaces.length;
  const visitedCount = savedPlaces.filter(p => (p.placeTags || []).includes('been_loved')).length;
  const favouriteCount = savedPlaces.filter(p => (p.placeTags || []).includes('favourite')).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:pl-16 lg:pl-56">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-5 py-4">
          <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        </div>
      </header>

      <main className="flex-1 pt-5 pb-28 md:pb-8">
        <div className="max-w-3xl mx-auto px-4 space-y-4">

          {/* Avatar card */}
          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-[0_2px_12px_rgb(0,0,0,0.04)]">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-teal-100 overflow-hidden flex items-center justify-center shrink-0">
                {avatarUrl
                  ? <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  : <User size={28} className="text-teal-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-slate-900 text-lg leading-tight">{displayName}</h2>
                {email && <p className="text-slate-500 text-sm mt-0.5 truncate">{email}</p>}
                {isGuest && (
                  <span className="inline-block mt-1 bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                    Guest mode
                  </span>
                )}
              </div>
            </div>

            {isGuest && (
              <button
                onClick={() => navigate('/login')}
                className="mt-4 w-full bg-teal-600 text-white font-semibold py-3 rounded-2xl shadow-md shadow-teal-500/20 hover:bg-teal-700 active:scale-95 transition-all"
              >
                Create account or sign in
              </button>
            )}
          </div>

          {/* Stats */}
          {!isGuest && (
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => navigate('/saved')}
                className="bg-white rounded-2xl p-4 border border-slate-100 flex flex-col items-center gap-1.5 hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <Heart size={20} className="text-rose-500" />
                </div>
                <p className="text-slate-900 font-bold text-xl leading-none">{savedCount}</p>
                <p className="text-slate-500 text-xs">Saved</p>
              </button>
              <button onClick={() => navigate('/saved')}
                className="bg-white rounded-2xl p-4 border border-slate-100 flex flex-col items-center gap-1.5 hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <MapPin size={20} className="text-emerald-600" />
                </div>
                <p className="text-slate-900 font-bold text-xl leading-none">{visitedCount}</p>
                <p className="text-slate-500 text-xs">Visited</p>
              </button>
              <button onClick={() => navigate('/saved')}
                className="bg-white rounded-2xl p-4 border border-slate-100 flex flex-col items-center gap-1.5 hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <Star size={20} className="text-amber-500" />
                </div>
                <p className="text-slate-900 font-bold text-xl leading-none">{favouriteCount}</p>
                <p className="text-slate-500 text-xs">Favourites</p>
              </button>
            </div>
          )}

          {/* Recently viewed */}
          {recentlyViewed.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-slate-400" />
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recently Viewed</p>
                </div>
                <button
                  onClick={() => { clearRecentlyViewed(); setRecentlyViewed([]); }}
                  className="text-slate-300 hover:text-slate-500 transition-colors"
                  title="Clear history"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 py-4 pb-5">
                {recentlyViewed.map(item => {
                  const photoUrl = item.photoReference
                    ? `/api/places/photo?photoReference=${encodeURIComponent(item.photoReference)}&maxWidth=200`
                    : null;
                  return (
                    <button
                      key={item.placeId}
                      onClick={() => navigate(`/venue/${item.placeId}`)}
                      className="shrink-0 flex flex-col items-center gap-2 w-20 group"
                    >
                      <div className="w-16 h-16 rounded-2xl overflow-hidden bg-slate-100 group-hover:ring-2 group-hover:ring-teal-400 transition-all">
                        {photoUrl
                          ? <img src={photoUrl} alt={item.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><MapPin size={18} className="text-slate-300" /></div>}
                      </div>
                      <p className="text-xs text-slate-600 text-center leading-tight font-medium line-clamp-2">{item.name}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Settings */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Account</p>
            </div>
            <button
              onClick={handleShare}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <Share2 size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium flex-1 text-left">Share FamPals</span>
              <ChevronRight size={16} className="text-slate-400" />
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <MapPin size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium flex-1 text-left">Explore</span>
              <ChevronRight size={16} className="text-slate-400" />
            </button>
            <button
              onClick={() => navigate('/saved')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-rose-50 rounded-xl flex items-center justify-center shrink-0">
                <Heart size={17} className="text-rose-500" />
              </div>
              <span className="text-slate-700 text-sm font-medium flex-1 text-left">Saved places</span>
              <ChevronRight size={16} className="text-slate-400" />
            </button>
          </div>

          {/* About */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <Shield size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-500 text-sm">FamPals — Family adventures, made easy</span>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="w-full bg-white border border-rose-100 rounded-2xl py-3.5 flex items-center justify-center gap-2 text-rose-500 font-semibold text-sm hover:bg-rose-50 transition-colors"
          >
            <LogOut size={18} />
            {isGuest ? 'Exit guest mode' : 'Sign out'}
          </button>
        </div>
      </main>

      {/* Confirm sign out sheet */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-t-3xl md:rounded-3xl w-full max-w-sm p-6 pb-10 md:pb-6 animate-fade-in">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Sign out?</h3>
            <p className="text-slate-500 text-sm mb-6">You'll need to sign in again to access your saved places.</p>
            <div className="flex flex-col gap-2">
              <button onClick={confirmSignOut} className="bg-rose-500 text-white py-3.5 rounded-2xl font-semibold hover:bg-rose-600 transition-colors">
                Sign out
              </button>
              <button onClick={() => setShowConfirm(false)} className="bg-slate-100 text-slate-700 py-3.5 rounded-2xl font-semibold hover:bg-slate-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
