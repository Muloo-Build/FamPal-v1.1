import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, MapPin, Phone, Globe, Heart,
  Share2, Clock, ExternalLink,
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
        const r = data.result;
        if (!r) { setError('Place not found'); return; }
        setVenue({
          placeId,
          name: r.name,
          vicinity: r.vicinity || r.formatted_address || '',
          formattedAddress: r.formatted_address,
          rating: r.rating,
          userRatingsTotal: r.user_ratings_total,
          photoReferences: (r.photos || []).slice(0, 6).map((p: any) => p.photo_reference),
          phone: r.formatted_phone_number || r.international_phone_number,
          website: r.website,
          openNow: r.opening_hours?.open_now,
          editorialSummary: r.editorial_summary?.overview,
          types: r.types || [],
          lat: r.geometry?.location?.lat ?? 0,
          lng: r.geometry?.location?.lng ?? 0,
        });
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
      navigator.clipboard.writeText(mapsUrl).catch(() => {});
    }
  };

  const currentPhoto = venue?.photoReferences[photoIdx];
  const photoUrl = currentPhoto
    ? `/api/places/photo?photoReference=${encodeURIComponent(currentPhoto)}&maxWidth=800`
    : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="h-72 bg-slate-200 animate-pulse" />
        <div className="p-5 space-y-4">
          <div className="h-7 bg-slate-200 rounded-xl animate-pulse w-3/4" />
          <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-1/2" />
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !venue) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 p-6">
        <MapPin size={40} className="text-slate-300" />
        <p className="text-slate-500 font-medium">{error || 'Place not found'}</p>
        <button onClick={() => navigate(-1)} className="bg-teal-600 text-white px-6 py-2.5 rounded-full font-semibold text-sm">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero photo */}
      <div className="relative h-72 bg-slate-200">
        {photoUrl ? (
          <img src={photoUrl} alt={venue.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100">
            <MapPin size={48} className="text-teal-200" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />

        {/* Top controls */}
        <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 pt-safe" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
          <button
            onClick={() => navigate(-1)}
            className="p-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-transform"
          >
            <ArrowLeft size={20} className="text-slate-800" />
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleShare}
              className="p-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-transform"
            >
              <Share2 size={20} className="text-slate-800" />
            </button>
            {user && (
              <button
                onClick={handleToggleSave}
                className={`p-2.5 backdrop-blur-md rounded-full shadow-sm active:scale-95 transition-all ${
                  isSaved ? 'bg-rose-500' : 'bg-white/90'
                }`}
              >
                <Heart size={20} fill={isSaved ? 'white' : 'none'} className={isSaved ? 'text-white' : 'text-slate-800'} />
              </button>
            )}
          </div>
        </div>

        {/* Photo navigation dots */}
        {venue.photoReferences.length > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {venue.photoReferences.map((_, i) => (
              <button
                key={i}
                onClick={() => setPhotoIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === photoIdx ? 'bg-white w-4' : 'bg-white/50'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-5 pt-5 pb-28">
        {/* Name + rating */}
        <div className="flex items-start justify-between gap-3 mb-2">
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

        {/* Address */}
        <div className="flex items-start gap-2 mb-4">
          <MapPin size={16} className="text-teal-600 mt-0.5 shrink-0" />
          <p className="text-slate-500 text-sm leading-relaxed">{venue.formattedAddress || venue.vicinity}</p>
        </div>

        {/* Open status */}
        {venue.openNow !== undefined && (
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold mb-4 ${
            venue.openNow ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
          }`}>
            <Clock size={14} />
            {venue.openNow ? 'Open now' : 'Closed'}
          </div>
        )}

        {/* Summary */}
        {venue.editorialSummary && (
          <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-100">
            <p className="text-slate-600 text-sm leading-relaxed">{venue.editorialSummary}</p>
          </div>
        )}

        {/* Contact info */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-4">
          {venue.phone && (
            <a
              href={`tel:${venue.phone}`}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 active:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <Phone size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium">{venue.phone}</span>
            </a>
          )}
          {venue.website && (
            <a
              href={venue.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 active:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
                <Globe size={17} className="text-teal-600" />
              </div>
              <span className="text-slate-700 text-sm font-medium truncate flex-1">{venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              <ExternalLink size={14} className="text-slate-400 shrink-0" />
            </a>
          )}
          <a
            href={`https://www.google.com/maps/place/?q=place_id:${venue.placeId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 transition-colors"
          >
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={17} className="text-teal-600" />
            </div>
            <span className="text-slate-700 text-sm font-medium">Open in Google Maps</span>
            <ExternalLink size={14} className="text-slate-400 ml-auto shrink-0" />
          </a>
        </div>

        {/* Save CTA for non-logged-in guest */}
        {!user && (
          <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-4 text-center">
            <p className="text-teal-800 text-sm font-medium mb-2">Sign in to save this place</p>
            <button
              onClick={() => navigate('/login')}
              className="bg-teal-600 text-white px-6 py-2 rounded-full text-sm font-semibold"
            >
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
