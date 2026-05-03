import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, auth, signOut } from './lib/firebase';
import type { AuthUser } from './lib/firebase';
import LoginScreen from './src/screens/Login';
import ExploreScreen from './src/screens/Explore';
import VenueDetailScreen from './src/screens/VenueDetail';
import SavedScreen from './src/screens/Saved';
import ProfileScreen from './src/screens/Profile';

const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setIsGuest(false);
    });
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  const isLoggedIn = !!user || isGuest;

  const handleSignOut = async () => {
    await signOut(auth);
    setIsGuest(false);
  };

  return (
    <Routes>
      {/* Public — no auth required, user may be null */}
      <Route path="/" element={<ExploreScreen user={user ?? null} />} />
      <Route path="/venue/:placeId" element={<VenueDetailScreen user={user ?? null} />} />

      {/* Login page — redirect away if already authed */}
      <Route
        path="/login"
        element={
          !!user
            ? <Navigate to="/" replace />
            : <LoginScreen onGuest={() => setIsGuest(true)} />
        }
      />

      {/* Protected — require real auth or guest mode */}
      <Route
        path="/saved"
        element={
          isLoggedIn
            ? <SavedScreen user={user} />
            : <Navigate to="/login" replace />
        }
      />
      <Route
        path="/profile"
        element={
          isLoggedIn
            ? <ProfileScreen user={user} isGuest={isGuest} onSignOut={handleSignOut} />
            : <Navigate to="/login" replace />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
