import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, MapPin, Phone, Globe, Heart,
  Share2, Clock, ExternalLink, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { SavedPlace } from '../../types';
import { listenToSavedPlaces, upsertSavedPlace, deleteSavedPlace } from '../../lib/userData';

interface Props {
  user: AuthUser | null;
}

interface DetailVenue {
  name: string;
  vicinity: string;
  formattedAddress?: string;
  rating?: number;
  userRatingsTotal?: number;
  photoReferences: string[];
  phone?: string;
  website?: string;
  openNow?: boolean;
  editorialSummary?: string;
  types: string[];
  lat: number;
  lng: number;
  placeId: string;
}

function mapPlaceResponse(data: any, placeId: string): DetailVenue {
  // Support both new Places API (direct object) and legacy (wrapped in .result)
  const r = data.result ?? data;
  const isNew = !data.result;

  return {
    placeId,
    name: isNew ? (r.displayName?.text ?? r.name ?? '') : (r.name ?? ''),
    vicinity: isNew
      ? (r.shortFormattedAddress ?? r.formattedAddress ?? '')
      : (r.vicinity ?? r.formatted_address ?? ''),
    formattedAddress: isNew ? r.formattedAddress : r.formatted_address,
    rating: r.rating,
    userRatingsTotal: isNew ? r.userRatingCount : r.user_ratings_total,
    photoReferences: isNew
      ? (r.photos ?? []).slice(0, 8).map((p: any) => p.name ?? '')
      : (r.photos ?? []).slice(0, 8).map((p: any) => p.photo_reference ?? ''),
    phone: isNew
      ? (r.nationalPhoneNumber ?? r.internationalPhoneNumber)
      : (r.formatted_phone_number ?? r.international_phone_number),
    website: isNew ? r.websiteUri : r.website,
    openNow: isNew
      ? r.regularOpeningHours?.openNow
      : r.opening_hours?.open_now,
    editorialSummary: isNew
      ? (r.editorialSummary?.text ?? r.generativeSummary?.overview?.text)
      : r.editorial_summary?.overview,
    types: r.types ?? [],
    lat: isNew ? (r.location?.latitude ?? 0) : (r.geometry?.location?.lat ?? 0),
    lng: isNew ? (r.location?.longitude ?? 0) : (r.geometry?.location?.lng ?? 0),
  };
}

export default function VenueDetailScreen({ user }: Props) {
  const { placeId } = useParams<{ placeId: string }>();
  const navigate = useNavigate();
  const [venue, setVenue] = useState<DetailVenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    if (!user) return;
    return listenToSavedPlaces(user.uid, setSavedPlaces);
  }, [user]);

  useEffect(() => {
    if (!placeId) return;
    setLoading(true);
    fetch(`/api/places/details/${encodeURIComponent(placeId)}`)
      .then(r => r.json())
      .then(data => {
        const mapped = mapPlaceResponse(data, placeId);
        if (!mapped.name) { setError('Place not found'); return; }
        setVenue(mapped);
      })
      .catch(() => setError('Failed to load place details'))
      .finally(() => setLoading(false));
  }, [placeId]);

  const isSaved = savedPlaces.some(p => p.placeId === placeId);

  const handleToggleSave = async () => {
    if (!user || !venue) return;
    if (isSaved) {
      await deleteSavedPlace(user.uid, venue.placeId);
      setSavedPlaces(prev => prev.filter(p => p.placeId !== venue.placeId));
    } else {
      const place: SavedPlace = {
        placeId: venue.placeId,
        name: venue.name,
        address: venue.formattedAddress || venue.vicinity,
        rating: venue.rating,
        photoReference: venue.photoReferences[0],
        savedAt: new Date().toISOString(),
      };
      setSavedPlaces(prev => [place, ...prev]);
      await upsertSavedPlace(user.uid, place);
    }
  };

  const handleShare = async () => {
    if (!venue) return;
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${venue.placeId}`;
    if (navigator.share) {
      await navigator.share({ title: venue.name, url: mapsUrl }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(mapsUrl).catch(() => {});
    }
  };

  const photoUrl = (ref: string, w = 800) =>
    ref ? `/api/places/photo?photoReference=${encodeURIComponent(ref)}&maxWidth=${w}` : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 md:pl-16 lg:pl-56">
        <div className="h-72 bg-slate-200 animate-pulse md:hidden" />
        <div className="max-w-5xl mx-auto md:flex md:gap-8 md:pt-10 md:px-8">
          <div className="hidden md:block md:w-1/2 h-96 bg-slate-200 rounded-3xl animate-pulse" />
          <div className="p-5 md:flex-1 space-y-4">
            <div className="h-7 bg-slate-200 rounded-xl animate-pulse w-3/4" />
            <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-1/2" />
            <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !venue) {
    return (
      <div className="min-h-screen bg-slate-50 md:pl-16 lg:pl-56 flex flex-col items-center justify-center gap-4 p-6">
        <MapPin size={40} className="text-slate-300" />
        <p className="text-slate-500 font-medium">{error || 'Place not found'}</p>
        <button onClick={() => navigate(-1)} className="bg-teal-600 text-white px-6 py-2.5 rounded-full font-semibold text-sm">
          Go back
        </button>
      </div>
    );
  }

  const currentPhotoUrl = venue.photoReferences[photoIdx]
    ? photoUrl(venue.photoReferences[photoIdx])
    : null;

  return (
    <div className="min-h-screen bg-slate-50 md:pl-16 lg:pl-56">
      {/* ── Mobile layout ───────────────────────────────────── */}
      <div className="md:hidden">
        {/* Hero photo */}
        <div className="relative h-72 bg-slate-200">
          {currentPhotoUrl ? (
            <img src={currentPhotoUrl} alt={venue.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100">
              <MapPin size={48} className="text-teal-200" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />

          <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
            <button onClick={() => navigate(-1)} className="p-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-transform">
              <ArrowLeft size={20} className="text-slate-800" />
            </button>
            <div className="flex gap-2">
              <button onClick={handleShare} className="p-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-transform">
                <Share2 size={20} className="text-slate-800" />
              </button>
              {user && (
                <button onClick={handleToggleSave} className={`p-2.5 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-all ${isSaved ? 'bg-rose-500' : 'bg-white/90'}`}>
                  <Heart size={20} fill={isSaved ? 'white' : 'none'} className={isSaved ? 'text-white' : 'text-slate-800'} />
                </button>
              )}
            </div>
          </div>

          {venue.photoReferences.length > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {venue.photoReferences.map((_, i) => (
                <button key={i} onClick={() => setPhotoIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${i === photoIdx ? 'bg-white w-4' : 'bg-white/50 w-1.5'}`} />
              ))}
            </div>
          )}
        </div>

        {/* Mobile content */}
        <MobileContent venue={venue} isSaved={isSaved} user={user} onToggleSave={handleToggleSave} onShare={handleShare} navigate={navigate} />
      </div>

      {/* ── Desktop 2-column layout ──────────────────────────── */}
      <div className="hidden md:block">
        {/* Back button row */}
        <div className="max-w-6xl mx-auto px-8 pt-8 pb-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
          >
            <ArrowLeft size={18} />
            Back to Explore
          </button>
        </div>

        <div className="max-w-6xl mx-auto px-8 pb-12 flex gap-10 items-start">
          {/* Left: photo gallery */}
          <div className="w-[45%] shrink-0">
            <div className="relative rounded-3xl overflow-hidden bg-slate-200 aspect-[4/3] shadow-lg">
              {currentPhotoUrl ? (
                <img src={currentPhotoUrl} alt={venue.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100">
                  <MapPin size={48} className="text-teal-200" />
                </div>
              )}
              {venue.photoReferences.length > 1 && (
                <>
                  <button
                    onClick={() => setPhotoIdx(i => Math.max(0, i - 1))}
                    disabled={photoIdx === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-white/90 rounded-full shadow-sm disabled:opacity-30 hover:bg-white transition-all"
                  >
                    <ChevronLeft size={18} className="text-slate-800" />
                  </button>
                  <button
                    onClick={() => setPhotoIdx(i => Math.min(venue.photoReferences.length - 1, i + 1))}
                    disabled={photoIdx === venue.photoReferences.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white/90 rounded-full shadow-sm disabled:opacity-30 hover:bg-white transition-all"
                  >
                    <ChevronRight size={18} className="text-slate-800" />
                  </button>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                    {venue.photoReferences.map((_, i) => (
                      <button key={i} onClick={() => setPhotoIdx(i)}
                        className={`h-1.5 rounded-full transition-all ${i === photoIdx ? 'bg-white w-4' : 'bg-white/50 w-1.5'}`} />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {venue.photoReferences.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-1">
                {venue.photoReferences.map((ref, i) => {
                  const thumb = photoUrl(ref, 200);
                  return thumb ? (
                    <button key={i} onClick={() => setPhotoIdx(i)}
                      className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 transition-all ${i === photoIdx ? 'ring-2 ring-teal-500' : 'opacity-60 hover:opacity-100'}`}
                    >
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Right: info */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-2">
                <h1 className="text-3xl font-bold text-slate-900 leading-tight">{venue.name}</h1>
                <div className="flex gap-2 shrink-0">
                  <button onClick={handleShare}
                    className="p-2.5 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
                    <Share2 size={18} className="text-slate-600" />
                  </button>
                  {user && (
                    <button onClick={handleToggleSave}
                      className={`p-2.5 rounded-full transition-all ${isSaved ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-100 hover:bg-slate-200'}`}>
                      <Heart size={18} fill={isSaved ? 'white' : 'none'} className={isSaved ? 'text-white' : 'text-slate-600'} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-3">
                {venue.rating && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-xl">
                    <Star size={15} className="fill-amber-400 text-amber-400" />
                    <span className="font-bold text-amber-700">{venue.rating.toFixed(1)}</span>
                    {venue.userRatingsTotal && (
                      <span className="text-amber-600 text-xs">({venue.userRatingsTotal.toLocaleString()})</span>
                    )}
                  </div>
                )}
                {venue.openNow !== undefined && (
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold ${venue.openNow ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                    <Clock size={14} />
                    {venue.openNow ? 'Open now' : 'Closed'}
                  </div>
                )}
              </div>
            </div>

            {/* Address */}
            <div className="flex items-start gap-2">
              <MapPin size={16} className="text-teal-600 mt-0.5 shrink-0" />
              <p className="text-slate-500 text-sm leading-relaxed">{venue.formattedAddress || venue.vicinity}</p>
            </div>

            {/* Summary */}
            {venue.editorialSummary && (
              <div className="bg-white rounded-2xl p-4 border border-slate-100">
                <p className="text-slate-600 text-sm leading-relaxed">{venue.editorialSummary}</p>
              </div>
            )}

            {/* Contact info */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {venue.phone && (
                <a href={`tel:${venue.phone}`}
                  className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                    <Phone size={17} className="text-teal-600" />
                  </div>
                  <span className="text-slate-700 text-sm font-medium">{venue.phone}</span>
                </a>
              )}
              {venue.website && (
                <a href={venue.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                    <Globe size={17} className="text-teal-600" />
                  </div>
                  <span className="text-slate-700 text-sm font-medium truncate flex-1">{venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                  <ExternalLink size={14} className="text-slate-400 shrink-0" />
                </a>
              )}
              <a href={`https://www.google.com/maps/place/?q=place_id:${venue.placeId}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin size={17} className="text-teal-600" />
                </div>
                <span className="text-slate-700 text-sm font-medium">Open in Google Maps</span>
                <ExternalLink size={14} className="text-slate-400 ml-auto shrink-0" />
              </a>
            </div>

            {/* Save CTA for guest */}
            {!user && (
              <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-4 text-center">
                <p className="text-teal-800 text-sm font-medium mb-2">Sign in to save this place</p>
                <button onClick={() => navigate('/login')}
                  className="bg-teal-600 text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-teal-700 transition-colors">
                  Sign in
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileContent({ venue, isSaved, user, onToggleSave, onShare, navigate }: {
  venue: DetailVenue;
  isSaved: boolean;
  user: AuthUser | null;
  onToggleSave: () => void;
  onShare: () => void;
  navigate: (to: any) => void;
}) {
  return (
    <div className="px-5 pt-5 pb-28 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 leading-tight flex-1">{venue.name}</h1>
        {venue.rating && (
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-100 px-2.5 py-1.5 rounded-xl shrink-0">
            <Star size={15} className="fill-amber-400 text-amber-400" />
            <span className="font-bold text-amber-700">{venue.rating.toFixed(1)}</span>
            {venue.userRatingsTotal && (
              <span className="text-amber-600 text-xs">({venue.userRatingsTotal.toLocaleString()})</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2">
        <MapPin size={16} className="text-teal-600 mt-0.5 shrink-0" />
        <p className="text-slate-500 text-sm leading-relaxed">{venue.formattedAddress || venue.vicinity}</p>
      </div>

      {venue.openNow !== undefined && (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${venue.openNow ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
          <Clock size={14} />
          {venue.openNow ? 'Open now' : 'Closed'}
        </div>
      )}

      {venue.editorialSummary && (
        <div className="bg-white rounded-2xl p-4 border border-slate-100">
          <p className="text-slate-600 text-sm leading-relaxed">{venue.editorialSummary}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {venue.phone && (
          <a href={`tel:${venue.phone}`} className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 active:bg-slate-50 transition-colors">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
              <Phone size={17} className="text-teal-600" />
            </div>
            <span className="text-slate-700 text-sm font-medium">{venue.phone}</span>
          </a>
        )}
        {venue.website && (
          <a href={venue.website} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 active:bg-slate-50 transition-colors">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
              <Globe size={17} className="text-teal-600" />
            </div>
            <span className="text-slate-700 text-sm font-medium truncate flex-1">{venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
            <ExternalLink size={14} className="text-slate-400 shrink-0" />
          </a>
        )}
        <a href={`https://www.google.com/maps/place/?q=place_id:${venue.placeId}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 transition-colors">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
            <MapPin size={17} className="text-teal-600" />
          </div>
          <span className="text-slate-700 text-sm font-medium">Open in Google Maps</span>
          <ExternalLink size={14} className="text-slate-400 ml-auto shrink-0" />
        </a>
      </div>

      {!user && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-4 text-center">
          <p className="text-teal-800 text-sm font-medium mb-2">Sign in to save this place</p>
          <button onClick={() => navigate('/login')}
            className="bg-teal-600 text-white px-6 py-2 rounded-full text-sm font-semibold">
            Sign in
          </button>
        </div>
      )}
    </div>
  );
}
