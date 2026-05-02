import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, MapPin, Star, Heart, Trash2 } from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { SavedPlace } from '../../types';
import { listenToSavedPlaces, deleteSavedPlace } from '../../lib/userData';
import BottomNav from '../components/BottomNav';

interface Props {
  user: AuthUser | null;
}

export default function SavedScreen({ user }: Props) {
  const navigate = useNavigate();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const unsub = listenToSavedPlaces(user.uid, (places) => {
      setSavedPlaces(places);
      setLoading(false);
    });
    return unsub;
  }, [user]);

  const handleDelete = async (placeId: string) => {
    if (!user) return;
    setDeletingId(placeId);
    try {
      await deleteSavedPlace(user.uid, placeId);
      setSavedPlaces(prev => prev.filter(p => p.placeId !== placeId));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-100 px-5 pt-safe" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <div className="pb-4">
          <h1 className="text-2xl font-bold text-slate-900">Saved</h1>
          <p className="text-slate-500 text-sm mt-0.5">Your favourite family spots</p>
        </div>
      </header>

      <main className="flex-1 px-4 pt-5 pb-28">
        {!user ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-4">
            <Bookmark size={48} className="text-slate-200" />
            <h3 className="text-lg font-semibold text-slate-700">Sign in to save places</h3>
            <p className="text-slate-400 text-sm text-center max-w-xs">
              Create an account to keep track of your favourite family-friendly spots.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="bg-teal-600 text-white px-6 py-3 rounded-full font-semibold mt-2 shadow-md shadow-teal-500/20"
            >
              Sign in
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl p-4 border border-slate-100 animate-pulse flex gap-3">
                <div className="w-16 h-16 bg-slate-200 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : savedPlaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3">
            <Heart size={48} className="text-slate-200" />
            <h3 className="text-lg font-semibold text-slate-700">No saved places yet</h3>
            <p className="text-slate-400 text-sm text-center max-w-xs">
              Tap the heart icon on any venue to save it here.
            </p>
            <button
              onClick={() => navigate('/')}
              className="bg-teal-600 text-white px-6 py-3 rounded-full font-semibold mt-2 shadow-md shadow-teal-500/20"
            >
              Explore places
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in">
            {savedPlaces.map(place => {
              const photoUrl = place.photoReference
                ? `/api/places/photo?photoReference=${encodeURIComponent(place.photoReference)}&maxWidth=200`
                : null;

              return (
                <div
                  key={place.placeId}
                  onClick={() => navigate(`/venue/${place.placeId}`)}
                  className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_12px_rgb(0,0,0,0.04)] overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
                >
                  <div className="flex items-center gap-3 p-3 pr-2">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                      {photoUrl ? (
                        <img src={photoUrl} alt={place.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <MapPin size={20} className="text-slate-300" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 text-sm truncate">{place.name}</h3>
                      <p className="text-slate-500 text-xs mt-0.5 truncate">{place.address}</p>
                      {place.rating && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star size={12} className="fill-amber-400 text-amber-400" />
                          <span className="text-xs font-semibold text-amber-700">{place.rating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(place.placeId); }}
                      disabled={deletingId === place.placeId}
                      className="p-2.5 text-slate-300 hover:text-rose-400 active:scale-90 transition-all shrink-0 disabled:opacity-40"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
