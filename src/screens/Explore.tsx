import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, MapPin, X, SlidersHorizontal } from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { Venue, SavedPlace } from '../../types';
import { listenToSavedPlaces, upsertSavedPlace, deleteSavedPlace } from '../../lib/userData';
import VenueCard from '../components/VenueCard';
import BottomNav from '../components/BottomNav';

interface Props {
  user: AuthUser | null;
}

const CATEGORIES = [
  { label: 'All', type: undefined, keyword: 'family friendly kids' },
  { label: 'Parks', type: 'park', keyword: undefined },
  { label: 'Restaurants', type: 'restaurant', keyword: 'family' },
  { label: 'Play Areas', type: undefined, keyword: 'playground kids children' },
  { label: 'Museums', type: 'museum', keyword: undefined },
  { label: 'Beaches', type: undefined, keyword: 'beach family' },
];

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
}

function mapGooglePlace(place: any, userLat?: number, userLng?: number): Venue {
  const lat = place.geometry?.location?.lat ?? 0;
  const lng = place.geometry?.location?.lng ?? 0;
  return {
    placeId: place.place_id,
    name: place.name,
    vicinity: place.vicinity || place.formatted_address || '',
    rating: place.rating,
    userRatingsTotal: place.user_ratings_total,
    photoReference: place.photos?.[0]?.photo_reference,
    types: place.types || [],
    lat,
    lng,
    distance: userLat != null && userLng != null
      ? haversineDistance(userLat, userLng, lat, lng)
      : undefined,
  };
}

export default function ExploreScreen({ user }: Props) {
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [radius, setRadius] = useState(10);
  const [showRadius, setShowRadius] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchTimeout = useRef<number | null>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: 'Current Location' });
      },
      () => {
        setLocation({ lat: -33.9249, lng: 18.4241, name: 'Cape Town' });
      },
      { timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    return listenToSavedPlaces(user.uid, setSavedPlaces);
  }, [user]);

  const fetchPlaces = useCallback(async (catIdx: number, query: string, loc: typeof location) => {
    if (!loc) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');
    try {
      let data: any;
      if (query.trim()) {
        const params = new URLSearchParams({
          query: `${query} family`,
          lat: String(loc.lat),
          lng: String(loc.lng),
        });
        const res = await fetch(`/api/places/search?${params}`, { signal: ctrl.signal });
        data = await res.json();
      } else {
        const cat = CATEGORIES[catIdx];
        const params = new URLSearchParams({
          lat: String(loc.lat),
          lng: String(loc.lng),
          radius: String(radius * 1000),
        });
        if (cat.type) params.set('type', cat.type);
        if (cat.keyword) params.set('keyword', cat.keyword);
        const res = await fetch(`/api/places/nearby?${params}`, { signal: ctrl.signal });
        data = await res.json();
      }
      if (ctrl.signal.aborted) return;
      const results = (data.results || []).map((p: any) => mapGooglePlace(p, loc.lat, loc.lng));
      setVenues(results);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError('Could not load places. Please try again.');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [radius]);

  useEffect(() => {
    if (location) fetchPlaces(categoryIndex, searchQuery, location);
  }, [categoryIndex, searchQuery, location, fetchPlaces]);

  const handleSearchInput = (val: string) => {
    setInputValue(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = window.setTimeout(() => setSearchQuery(val), 500);
  };

  const clearSearch = () => {
    setInputValue('');
    setSearchQuery('');
  };

  const savedIds = new Set(savedPlaces.map(p => p.placeId));

  const handleToggleSave = async (venue: Venue) => {
    if (!user) return;
    const isSaved = savedIds.has(venue.placeId);
    if (isSaved) {
      await deleteSavedPlace(user.uid, venue.placeId);
      setSavedPlaces(prev => prev.filter(p => p.placeId !== venue.placeId));
    } else {
      const place: SavedPlace = {
        placeId: venue.placeId,
        name: venue.name,
        address: venue.vicinity,
        rating: venue.rating,
        photoReference: venue.photoReference,
        savedAt: new Date().toISOString(),
      };
      setSavedPlaces(prev => [place, ...prev]);
      await upsertSavedPlace(user.uid, place);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:pl-16 lg:pl-56">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 pt-safe pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:hidden">FamPals</h1>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 hidden md:block">Explore</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRadius(v => !v)}
                className="flex items-center gap-1.5 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full text-sm font-medium hover:bg-slate-200 active:bg-slate-200 transition-colors"
              >
                <SlidersHorizontal size={14} />
                {radius}km
              </button>
              <div className="flex items-center gap-1.5 bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full text-sm font-medium">
                <MapPin size={14} className="text-teal-600" />
                <span className="max-w-[120px] truncate">{location?.name ?? '…'}</span>
              </div>
            </div>
          </div>

          {showRadius && (
            <div className="mb-3 bg-slate-50 rounded-2xl px-4 py-3">
              <div className="flex justify-between text-sm text-slate-600 mb-1.5">
                <span>Search radius</span>
                <span className="font-semibold text-teal-600">{radius}km</span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={radius}
                onChange={e => setRadius(Number(e.target.value))}
                onMouseUp={() => { if (location) fetchPlaces(categoryIndex, searchQuery, location); }}
                onTouchEnd={() => { if (location) fetchPlaces(categoryIndex, searchQuery, location); }}
                className="w-full accent-teal-600"
              />
            </div>
          )}

          {/* Search */}
          <div className="relative mb-3">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={inputValue}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Find family-friendly places..."
              className="w-full bg-slate-100 rounded-2xl py-3 pl-11 pr-10 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 transition-all text-sm font-medium"
            />
            {inputValue && (
              <button onClick={clearSearch} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                <X size={18} />
              </button>
            )}
          </div>

          {/* Category chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-0.5">
            {CATEGORIES.map((cat, idx) => (
              <button
                key={cat.label}
                onClick={() => { setCategoryIndex(idx); setSearchQuery(''); setInputValue(''); }}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-all shrink-0 ${
                  categoryIndex === idx && !searchQuery
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 active:bg-slate-50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pt-5 pb-28 md:pb-8">
        <div className="max-w-7xl mx-auto px-4">
          {!location ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-3">
              <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-500 text-sm">Getting your location…</p>
            </div>
          ) : loading && venues.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="bg-white rounded-3xl overflow-hidden border border-slate-100 animate-pulse">
                  <div className="h-48 bg-slate-200" />
                  <div className="p-4 space-y-2">
                    <div className="h-5 bg-slate-200 rounded-lg w-3/4" />
                    <div className="h-4 bg-slate-100 rounded-lg w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-4">
              <p className="text-slate-500 text-center">{error}</p>
              <button
                onClick={() => fetchPlaces(categoryIndex, searchQuery, location)}
                className="bg-teal-600 text-white px-6 py-2.5 rounded-full font-semibold text-sm"
              >
                Try again
              </button>
            </div>
          ) : venues.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-2">
              <MapPin size={36} className="text-slate-300" />
              <p className="text-slate-500 font-medium">No places found</p>
              <p className="text-slate-400 text-sm text-center">Try a different category or expand the radius</p>
            </div>
          ) : (
            <div className="animate-fade-in">
              {searchQuery && (
                <p className="text-sm text-slate-500 mb-4">
                  {venues.length} result{venues.length !== 1 ? 's' : ''} for "<span className="font-medium text-slate-700">{searchQuery}</span>"
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {venues.map(venue => (
                  <VenueCard
                    key={venue.placeId}
                    venue={venue}
                    isSaved={savedIds.has(venue.placeId)}
                    onToggleSave={user ? handleToggleSave : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
