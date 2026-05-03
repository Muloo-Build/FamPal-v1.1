import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, MapPin, Phone, Globe, Heart,
  Share2, Clock, ExternalLink, ChevronLeft, ChevronRight,
  MessageSquare, Send, Trash2, X,
} from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { SavedPlace, PlaceReview, GoogleReview } from '../../types';
import { listenToSavedPlaces, upsertSavedPlace, deleteSavedPlace } from '../../lib/userData';

interface Props { user: AuthUser | null; }

interface DetailVenue {
  placeId: string;
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
  kidFriendly?: boolean;
  dogFriendly?: boolean;
  wheelchairAccessible?: boolean;
  outdoorSeating?: boolean;
  hasRestroom?: boolean;
  googleReviews: GoogleReview[];
}

function mapPlaceResponse(data: any, placeId: string): DetailVenue {
  const r = data.result ?? data;
  const isNew = !data.result;
  const gReviews: GoogleReview[] = (r.reviews || []).map((rv: any) => ({
    authorName: isNew ? rv.authorAttribution?.displayName : rv.author_name,
    authorPhoto: isNew ? rv.authorAttribution?.photoUri : rv.profile_photo_url,
    rating: rv.rating,
    text: isNew ? rv.text?.text : rv.text,
    relativeTime: isNew ? rv.relativePublishTimeDescription : rv.relative_time_description,
  }));
  return {
    placeId,
    name: isNew ? (r.displayName?.text ?? r.name ?? '') : (r.name ?? ''),
    vicinity: isNew ? (r.shortFormattedAddress ?? r.formattedAddress ?? '') : (r.vicinity ?? r.formatted_address ?? ''),
    formattedAddress: isNew ? r.formattedAddress : r.formatted_address,
    rating: r.rating,
    userRatingsTotal: isNew ? r.userRatingCount : r.user_ratings_total,
    photoReferences: isNew
      ? (r.photos ?? []).slice(0, 8).map((p: any) => p.name ?? '')
      : (r.photos ?? []).slice(0, 8).map((p: any) => p.photo_reference ?? ''),
    phone: isNew ? (r.nationalPhoneNumber ?? r.internationalPhoneNumber) : (r.formatted_phone_number ?? r.international_phone_number),
    website: isNew ? r.websiteUri : r.website,
    openNow: isNew ? r.regularOpeningHours?.openNow : r.opening_hours?.open_now,
    editorialSummary: isNew ? (r.editorialSummary?.text ?? r.generativeSummary?.overview?.text) : r.editorial_summary?.overview,
    types: r.types ?? [],
    lat: isNew ? (r.location?.latitude ?? 0) : (r.geometry?.location?.lat ?? 0),
    lng: isNew ? (r.location?.longitude ?? 0) : (r.geometry?.location?.lng ?? 0),
    kidFriendly: r.goodForChildren ?? false,
    dogFriendly: r.allowsDogs ?? false,
    wheelchairAccessible: r.accessibilityOptions?.wheelchairAccessibleEntrance ?? false,
    outdoorSeating: r.outdoorSeating ?? false,
    hasRestroom: r.restroom ?? false,
    googleReviews: gReviews,
  };
}

const REVIEW_TAGS = [
  'Great for kids', 'Dog friendly', 'Wheelchair accessible',
  'Clean facilities', 'Outdoor spaces', 'Affordable', 'Good parking', 'Quiet & peaceful',
];

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="transition-transform hover:scale-110"
        >
          <Star
            size={28}
            className={`transition-colors ${n <= (hover || value) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
          />
        </button>
      ))}
    </div>
  );
}

function ReviewCard({ review, canDelete, onDelete }: {
  review: PlaceReview;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 font-bold text-sm">
              {(review.display_name ?? 'A')[0].toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{review.display_name || 'Anonymous'}</p>
            <p className="text-xs text-slate-400">{new Date(review.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex">
            {[1,2,3,4,5].map(n => (
              <Star key={n} size={13} className={n <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
            ))}
          </div>
          {canDelete && onDelete && (
            <button onClick={onDelete} className="text-slate-300 hover:text-rose-400 transition-colors">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {review.body && <p className="text-slate-600 text-sm leading-relaxed">{review.body}</p>}
      {review.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {review.tags.map(tag => (
            <span key={tag} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function GoogleReviewCard({ review }: { review: GoogleReview }) {
  const [expanded, setExpanded] = useState(false);
  const text = review.text || '';
  const isLong = text.length > 180;
  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2">
      <div className="flex items-center gap-2">
        {review.authorPhoto ? (
          <img src={review.authorPhoto} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
            <span className="text-slate-500 font-bold text-sm">{(review.authorName ?? 'G')[0]}</span>
          </div>
        )}
        <div>
          <p className="text-sm font-semibold text-slate-800">{review.authorName}</p>
          <p className="text-xs text-slate-400">{review.relativeTime}</p>
        </div>
        <div className="ml-auto flex">
          {[1,2,3,4,5].map(n => (
            <Star key={n} size={13} className={n <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
          ))}
        </div>
      </div>
      {text && (
        <p className="text-slate-600 text-sm leading-relaxed">
          {isLong && !expanded ? text.slice(0, 180) + '…' : text}
          {isLong && (
            <button onClick={() => setExpanded(v => !v)} className="ml-1 text-teal-600 font-medium text-xs">
              {expanded ? 'Less' : 'More'}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

function ReviewsSection({ placeId, user, venue }: {
  placeId: string;
  user: AuthUser | null;
  venue: DetailVenue;
}) {
  const [reviews, setReviews] = useState<PlaceReview[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const myReview = user ? reviews.find(r => r.user_id === user.uid) : null;

  useEffect(() => {
    setLoadingReviews(true);
    fetch(`/api/reviews/${encodeURIComponent(placeId)}`)
      .then(r => r.json())
      .then(d => setReviews(d.reviews || []))
      .catch(() => {})
      .finally(() => setLoadingReviews(false));
  }, [placeId]);

  const toggleTag = (tag: string) =>
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || rating === 0) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const token = localStorage.getItem('fampal_auth_token');
      const res = await fetch(`/api/reviews/${encodeURIComponent(placeId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating, body: body.trim() || null, tags: selectedTags, displayName: user.displayName }),
      });
      if (!res.ok) { setSubmitError('Could not save review. Try again.'); return; }
      const { review } = await res.json();
      setReviews(prev => [review, ...prev.filter(r => r.user_id !== user.uid)]);
      setShowForm(false);
      setRating(0); setBody(''); setSelectedTags([]);
    } catch {
      setSubmitError('Could not save review. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    const token = localStorage.getItem('fampal_auth_token');
    await fetch(`/api/reviews/${encodeURIComponent(placeId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setReviews(prev => prev.filter(r => r.user_id !== user.uid));
  };

  const googleReviews = venue.googleReviews ?? [];
  const totalReviews = reviews.length + googleReviews.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-teal-600" />
          <h2 className="text-lg font-bold text-slate-900">Reviews</h2>
          {totalReviews > 0 && (
            <span className="text-sm text-slate-400">({totalReviews})</span>
          )}
        </div>
        {user && !myReview && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-teal-600 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-teal-700 transition-colors"
          >
            <Send size={14} />
            Write a review
          </button>
        )}
      </div>

      {/* Write review form */}
      {showForm && user && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-teal-100 p-4 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Your review</h3>
            <button type="button" onClick={() => { setShowForm(false); setRating(0); setBody(''); setSelectedTags([]); }}
              className="text-slate-400 hover:text-slate-600 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Stars */}
          <div>
            <p className="text-sm text-slate-500 mb-2">Rating <span className="text-rose-500">*</span></p>
            <StarPicker value={rating} onChange={setRating} />
          </div>

          {/* Tags */}
          <div>
            <p className="text-sm text-slate-500 mb-2">What stood out? <span className="text-slate-400 text-xs">(optional)</span></p>
            <div className="flex flex-wrap gap-2">
              {REVIEW_TAGS.map(tag => (
                <button
                  key={tag} type="button" onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    selectedTags.includes(tag)
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div>
            <p className="text-sm text-slate-500 mb-1.5">Tell others about your visit <span className="text-slate-400 text-xs">(optional)</span></p>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What was it like? Would you recommend it to other families?"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 resize-none transition-all"
            />
            <p className="text-right text-xs text-slate-400 mt-1">{body.length}/500</p>
          </div>

          {submitError && (
            <p className="text-rose-500 text-sm bg-rose-50 px-3 py-2 rounded-xl">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={rating === 0 || submitting}
            className="w-full bg-teal-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {submitting
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <><Send size={15} /> Submit review</>}
          </button>
        </form>
      )}

      {/* Sign in prompt */}
      {!user && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-3 flex items-center gap-3">
          <MessageSquare size={18} className="text-teal-600 shrink-0" />
          <p className="text-sm text-teal-800">Sign in to write a review and share your experience with other families.</p>
        </div>
      )}

      {/* FamPals reviews */}
      {loadingReviews ? (
        <div className="space-y-3">
          {[1,2].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse">
              <div className="flex gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-slate-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-slate-200 rounded w-1/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/4" />
                </div>
              </div>
              <div className="h-3 bg-slate-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {reviews.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">FamPals Reviews</p>
              {reviews.map(r => (
                <ReviewCard
                  key={r.id} review={r}
                  canDelete={user?.uid === r.user_id}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {googleReviews.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Google Reviews</p>
              {googleReviews.map((r, i) => <GoogleReviewCard key={i} review={r} />)}
            </div>
          )}

          {totalReviews === 0 && !showForm && (
            <div className="text-center py-8">
              <MessageSquare size={32} className="text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">No reviews yet — be the first!</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AttributeBadges({ venue }: { venue: DetailVenue }) {
  const attrs = [
    venue.kidFriendly         && { emoji: '👶', label: 'Kid Friendly' },
    venue.dogFriendly         && { emoji: '🐕', label: 'Dog Friendly' },
    venue.wheelchairAccessible && { emoji: '♿', label: 'Wheelchair Accessible' },
    venue.outdoorSeating      && { emoji: '🌿', label: 'Outdoor Seating' },
    venue.hasRestroom         && { emoji: '🚻', label: 'Restrooms' },
  ].filter(Boolean) as { emoji: string; label: string }[];
  if (attrs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attrs.map(a => (
        <div key={a.label} className="flex items-center gap-1.5 bg-teal-50 border border-teal-100 text-teal-700 px-3 py-1.5 rounded-xl text-sm font-medium">
          <span>{a.emoji}</span>
          <span>{a.label}</span>
        </div>
      ))}
    </div>
  );
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
        placeId: venue.placeId, name: venue.name,
        address: venue.formattedAddress || venue.vicinity,
        rating: venue.rating, photoReference: venue.photoReferences[0],
        savedAt: new Date().toISOString(),
      };
      setSavedPlaces(prev => [place, ...prev]);
      await upsertSavedPlace(user.uid, place);
    }
  };

  const handleShare = async () => {
    if (!venue) return;
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${venue.placeId}`;
    if (navigator.share) await navigator.share({ title: venue.name, url: mapsUrl }).catch(() => {});
    else await navigator.clipboard.writeText(mapsUrl).catch(() => {});
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
        <button onClick={() => navigate(-1)} className="bg-teal-600 text-white px-6 py-2.5 rounded-full font-semibold text-sm">Go back</button>
      </div>
    );
  }

  const currentPhotoUrl = venue.photoReferences[photoIdx]
    ? photoUrl(venue.photoReferences[photoIdx])
    : null;

  return (
    <div className="min-h-screen bg-slate-50 md:pl-16 lg:pl-56">

      {/* ── Mobile layout ──────────────────────────────────────────────────── */}
      <div className="md:hidden">
        {/* Hero */}
        <div className="relative h-72 bg-slate-200">
          {currentPhotoUrl
            ? <img src={currentPhotoUrl} alt={venue.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100"><MapPin size={48} className="text-teal-200" /></div>}
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
        <div className="px-5 pt-5 pb-28 space-y-5">
          <VenueInfo venue={venue} isSaved={isSaved} user={user} onToggleSave={handleToggleSave} onShare={handleShare} navigate={navigate} showActions={false} />
          <AttributeBadges venue={venue} />
          <ContactCard venue={venue} />
          {!user && <GuestCTA navigate={navigate} />}
          <ReviewsSection placeId={venue.placeId} user={user} venue={venue} />
        </div>
      </div>

      {/* ── Desktop 2-column layout ───────────────────────────────────────── */}
      <div className="hidden md:block">
        <div className="max-w-6xl mx-auto px-8 pt-8 pb-4">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium">
            <ArrowLeft size={18} /> Back to Explore
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-8 pb-12 flex gap-10 items-start">
          {/* Left: photo gallery */}
          <div className="w-[42%] shrink-0 sticky top-20">
            <div className="relative rounded-3xl overflow-hidden bg-slate-200 aspect-[4/3] shadow-lg">
              {currentPhotoUrl
                ? <img src={currentPhotoUrl} alt={venue.name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100"><MapPin size={48} className="text-teal-200" /></div>}
              {venue.photoReferences.length > 1 && (
                <>
                  <button onClick={() => setPhotoIdx(i => Math.max(0, i - 1))} disabled={photoIdx === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-white/90 rounded-full shadow-sm disabled:opacity-30 hover:bg-white transition-all">
                    <ChevronLeft size={18} className="text-slate-800" />
                  </button>
                  <button onClick={() => setPhotoIdx(i => Math.min(venue.photoReferences.length - 1, i + 1))} disabled={photoIdx === venue.photoReferences.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white/90 rounded-full shadow-sm disabled:opacity-30 hover:bg-white transition-all">
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
            {venue.photoReferences.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-1">
                {venue.photoReferences.map((ref, i) => {
                  const thumb = photoUrl(ref, 200);
                  return thumb ? (
                    <button key={i} onClick={() => setPhotoIdx(i)}
                      className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 transition-all ${i === photoIdx ? 'ring-2 ring-teal-500' : 'opacity-60 hover:opacity-100'}`}>
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Right: info */}
          <div className="flex-1 min-w-0 space-y-5">
            <VenueInfo venue={venue} isSaved={isSaved} user={user} onToggleSave={handleToggleSave} onShare={handleShare} navigate={navigate} showActions desktop />
            <AttributeBadges venue={venue} />
            <ContactCard venue={venue} />
            {!user && <GuestCTA navigate={navigate} />}
            <ReviewsSection placeId={venue.placeId} user={user} venue={venue} />
          </div>
        </div>
      </div>
    </div>
  );
}

function VenueInfo({ venue, isSaved, user, onToggleSave, onShare, navigate, showActions, desktop }: {
  venue: DetailVenue; isSaved: boolean; user: AuthUser | null;
  onToggleSave: () => void; onShare: () => void; navigate: (to: any) => void;
  showActions?: boolean; desktop?: boolean;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h1 className={`font-bold text-slate-900 leading-tight flex-1 ${desktop ? 'text-3xl' : 'text-2xl'}`}>{venue.name}</h1>
        {(showActions || desktop) && (
          <div className="flex gap-2 shrink-0">
            <button onClick={onShare} className="p-2.5 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
              <Share2 size={18} className="text-slate-600" />
            </button>
            {user && (
              <button onClick={onToggleSave} className={`p-2.5 rounded-full transition-all ${isSaved ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-100 hover:bg-slate-200'}`}>
                <Heart size={18} fill={isSaved ? 'white' : 'none'} className={isSaved ? 'text-white' : 'text-slate-600'} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-2.5 mb-3">
        {venue.rating && (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 px-2.5 py-1.5 rounded-xl">
            <Star size={14} className="fill-amber-400 text-amber-400" />
            <span className="font-bold text-amber-700">{venue.rating.toFixed(1)}</span>
            {venue.userRatingsTotal && <span className="text-amber-600 text-xs">({venue.userRatingsTotal.toLocaleString()})</span>}
          </div>
        )}
        {venue.openNow !== undefined && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-semibold ${venue.openNow ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
            <Clock size={13} />{venue.openNow ? 'Open now' : 'Closed'}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        <MapPin size={15} className="text-teal-600 mt-0.5 shrink-0" />
        <p className="text-slate-500 text-sm leading-relaxed">{venue.formattedAddress || venue.vicinity}</p>
      </div>
      {venue.editorialSummary && (
        <div className="mt-3 bg-white rounded-2xl p-4 border border-slate-100">
          <p className="text-slate-600 text-sm leading-relaxed">{venue.editorialSummary}</p>
        </div>
      )}
    </div>
  );
}

function ContactCard({ venue }: { venue: DetailVenue }) {
  const hasAny = venue.phone || venue.website;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      {venue.phone && (
        <a href={`tel:${venue.phone}`} className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 active:bg-slate-50 transition-colors">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0"><Phone size={17} className="text-teal-600" /></div>
          <span className="text-slate-700 text-sm font-medium">{venue.phone}</span>
        </a>
      )}
      {venue.website && (
        <a href={venue.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 active:bg-slate-50 transition-colors">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0"><Globe size={17} className="text-teal-600" /></div>
          <span className="text-slate-700 text-sm font-medium truncate flex-1">{venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
          <ExternalLink size={14} className="text-slate-400 shrink-0" />
        </a>
      )}
      <a href={`https://www.google.com/maps/place/?q=place_id:${venue.placeId}`} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-50 transition-colors">
        <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0"><MapPin size={17} className="text-teal-600" /></div>
        <span className="text-slate-700 text-sm font-medium">Open in Google Maps</span>
        <ExternalLink size={14} className="text-slate-400 ml-auto shrink-0" />
      </a>
    </div>
  );
}

function GuestCTA({ navigate }: { navigate: (to: any) => void }) {
  return (
    <div className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-4 text-center">
      <p className="text-teal-800 text-sm font-medium mb-2">Sign in to save this place and write reviews</p>
      <button onClick={() => navigate('/login')} className="bg-teal-600 text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-teal-700 transition-colors">
        Sign in
      </button>
    </div>
  );
}
