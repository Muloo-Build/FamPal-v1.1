import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Mail, LogOut, ChevronRight, MapPin,
  Heart, Star, Shield, Moon, Sun,
} from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import BottomNav from '../components/BottomNav';

interface Props {
  user: AuthUser | null;
  isGuest: boolean;
  onSignOut: () => void;
}

export default function ProfileScreen({ user, isGuest, onSignOut }: Props) {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSignOut = () => {
    if (isGuest) { onSignOut(); return; }
    setShowConfirm(true);
  };

  const confirmSignOut = () => {
    setShowConfirm(false);
    onSignOut();
  };

  const avatarUrl = user?.photoURL;
  const displayName = user?.displayName || (isGuest ? 'Guest' : 'FamPal User');
  const email = user?.email;

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
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <User size={28} className="text-teal-600" />
                )}
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

          {/* Quick stats */}
          {!isGuest && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate('/saved')}
                className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-50 transition-colors"
              >
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <Heart size={20} className="text-rose-500" />
                </div>
                <div>
                  <p className="text-slate-900 font-bold text-lg leading-none">—</p>
                  <p className="text-slate-500 text-xs mt-0.5">Saved</p>
                </div>
              </button>
              <div className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                  <Star size={20} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-slate-900 font-bold text-lg leading-none">—</p>
                  <p className="text-slate-500 text-xs mt-0.5">Visited</p>
                </div>
              </div>
            </div>
          )}

          {/* Settings */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Settings</p>
            </div>

            <button
              onClick={() => { setDarkMode(v => !v); document.documentElement.classList.toggle('dark'); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 hover:bg-slate-50 active:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                {darkMode ? <Moon size={17} className="text-slate-600" /> : <Sun size={17} className="text-slate-600" />}
              </div>
              <span className="text-slate-700 text-sm font-medium flex-1 text-left">Appearance</span>
              <span className="text-slate-400 text-sm">{darkMode ? 'Dark' : 'Light'}</span>
            </button>

            <button
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 hover:bg-slate-50 active:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <MapPin size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium flex-1 text-left">Explore</span>
              <ChevronRight size={16} className="text-slate-400" />
            </button>

            <button
              onClick={() => navigate('/saved')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-50 transition-colors"
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
            <div className="px-4 py-3 border-b border-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">About</p>
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <Shield size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium">FamPals v2.0 — Clean &amp; Light</span>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="w-full bg-white border border-rose-100 rounded-2xl py-3.5 flex items-center justify-center gap-2 text-rose-500 font-semibold text-sm hover:bg-rose-50 active:bg-rose-50 transition-colors"
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
              <button
                onClick={confirmSignOut}
                className="bg-rose-500 text-white py-3.5 rounded-2xl font-semibold hover:bg-rose-600 active:bg-rose-600 transition-colors"
              >
                Sign out
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="bg-slate-100 text-slate-700 py-3.5 rounded-2xl font-semibold hover:bg-slate-200 active:bg-slate-200 transition-colors"
              >
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
