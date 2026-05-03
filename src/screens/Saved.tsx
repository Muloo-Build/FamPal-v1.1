import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, MapPin, Star, Heart, Tag, PencilLine, Check, X } from 'lucide-react';
import type { AuthUser } from '../../lib/firebase';
import type { SavedPlace } from '../../types';
import { listenToSavedPlaces, deleteSavedPlace, patchSavedPlace } from '../../lib/userData';
import BottomNav from '../components/BottomNav';
import { PLACE_TAGS } from './VenueDetail';

interface Props { user: AuthUser | null; }

const FILTER_ALL = '__all__';

function TagSheet({ place, onSave, onClose }: {
  place: SavedPlace;
  onSave: (tags: string[], notes: string) => void;
  onClose: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>(place.placeTags || []);
  const [notes, setNotes] = useState(place.privateNotes || '');
  const toggleTag = (id: string) =>
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl md:rounded-3xl p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5 md:hidden" />
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900 leading-tight">{place.name}</h2>
            <p className="text-slate-400 text-sm mt-0.5">Edit tags and note</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
        </div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">How would you describe this place?</p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {PLACE_TAGS.map(t => {
            const active = selectedTags.includes(t.id);
            return (
              <button key={t.id} onClick={() => toggleTag(t.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                  active ? 'bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-500/20' : 'bg-white text-slate-700 border-slate-200 hover:border-teal-300'
                }`}>
                <span className="text-base">{t.emoji}</span>
                <span className="text-left leading-tight">{t.label}</span>
                {active && <Check size={14} className="ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Private note <span className="normal-case text-slate-300 font-normal">(only you can see this)</span>
        </p>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3}
          placeholder="Reminders, tips, 'bring your own snacks!'…"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 resize-none mb-4" />
        <button onClick={() => onSave(selectedTags, notes)}
          className="w-full bg-teal-600 text-white py-3 rounded-xl font-semibold hover:bg-teal-700 transition-colors">
          Save
        </button>
      </div>
    </div>
  );
}

export default function SavedScreen({ user }: Props) {
  const navigate = useNavigate();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [filterTag, setFilterTag] = useState(FILTER_ALL);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const unsub = listenToSavedPlaces(user.uid, places => { setSavedPlaces(places); setLoading(false); });
    return unsub;
  }, [user]);

  const handleDelete = async (placeId: string) => {
    if (!user) return;
    setDeletingId(placeId);
    try {
      await deleteSavedPlace(user.uid, placeId);
      setSavedPlaces(prev => prev.filter(p => p.placeId !== placeId));
    } finally { setDeletingId(null); }
  };

  const handleTagSave = async (tags: string[], notes: string) => {
    if (!user || !editingPlace) return;
    const placeId = editingPlace.placeId;
    setSavedPlaces(prev => prev.map(p => p.placeId === placeId ? { ...p, placeTags: tags, privateNotes: notes } : p));
    setEditingPlace(null);
    await patchSavedPlace(user.uid, placeId, { placeTags: tags, privateNotes: notes });
  };

  const filteredPlaces = filterTag === FILTER_ALL
    ? savedPlaces
    : savedPlaces.filter(p => (p.placeTags || []).includes(filterTag));

  const tagMap = Object.fromEntries(PLACE_TAGS.map(t => [t.id, t]));

  // Count per tag for filter badges
  const tagCounts = PLACE_TAGS.reduce<Record<string, number>>((acc, t) => {
    acc[t.id] = savedPlaces.filter(p => (p.placeTags || []).includes(t.id)).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:pl-16 lg:pl-56">
      {editingPlace && (
        <TagSheet place={editingPlace} onSave={handleTagSave} onClose={() => setEditingPlace(null)} />
      )}

      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-5 pt-4 pb-3">
          <h1 className="text-2xl font-bold text-slate-900 mb-0.5">Saved</h1>
          <p className="text-slate-500 text-sm">{savedPlaces.length} place{savedPlaces.length !== 1 ? 's' : ''} saved</p>
          {savedPlaces.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-5 px-5 mt-3 pb-0.5">
              <button onClick={() => setFilterTag(FILTER_ALL)}
                className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-sm font-semibold shrink-0 transition-all ${filterTag === FILTER_ALL ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/20' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}>
                All ({savedPlaces.length})
              </button>
              {PLACE_TAGS.filter(t => tagCounts[t.id] > 0).map(t => (
                <button key={t.id} onClick={() => setFilterTag(filterTag === t.id ? FILTER_ALL : t.id)}
                  className={`whitespace-nowrap flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold shrink-0 transition-all ${filterTag === t.id ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/20' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}>
                  <span>{t.emoji}</span>
                  <span>{t.label}</span>
                  <span className={`text-xs ${filterTag === t.id ? 'text-teal-100' : 'text-slate-400'}`}>({tagCounts[t.id]})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 pt-5 pb-28 md:pb-8">
        <div className="max-w-7xl mx-auto px-4">
          {!user ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-4">
              <Bookmark size={48} className="text-slate-200" />
              <h3 className="text-lg font-semibold text-slate-700">Sign in to save places</h3>
              <p className="text-slate-400 text-sm text-center max-w-xs">Create an account to keep track of your favourite family-friendly spots.</p>
              <button onClick={() => navigate('/login')} className="bg-teal-600 text-white px-6 py-3 rounded-full font-semibold mt-2 shadow-md shadow-teal-500/20">Sign in</button>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl p-4 border border-slate-100 animate-pulse flex gap-3">
                  <div className="w-16 h-16 bg-slate-200 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2"><div className="h-4 bg-slate-200 rounded w-3/4" /><div className="h-3 bg-slate-100 rounded w-1/2" /></div>
                </div>
              ))}
            </div>
          ) : savedPlaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-3">
              <Heart size={48} className="text-slate-200" />
              <h3 className="text-lg font-semibold text-slate-700">No saved places yet</h3>
              <p className="text-slate-400 text-sm text-center max-w-xs">Tap the heart icon on any venue to save it here.</p>
              <button onClick={() => navigate('/')} className="bg-teal-600 text-white px-6 py-3 rounded-full font-semibold mt-2 shadow-md shadow-teal-500/20">Explore places</button>
            </div>
          ) : filteredPlaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-20 gap-3">
              <Tag size={36} className="text-slate-200" />
              <p className="text-slate-500 font-medium">No places tagged as "{tagMap[filterTag]?.label}"</p>
              <button onClick={() => setFilterTag(FILTER_ALL)} className="text-teal-600 text-sm font-semibold hover:underline">Show all saved places</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
              {filteredPlaces.map(place => {
                const photoUrl = place.photoReference
                  ? `/api/places/photo?photoReference=${encodeURIComponent(place.photoReference)}&maxWidth=200`
                  : null;
                const tags = place.placeTags || [];

                return (
                  <div key={place.placeId}
                    className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_12px_rgb(0,0,0,0.04)] overflow-hidden hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all cursor-pointer group"
                    onClick={() => navigate(`/venue/${place.placeId}`)}>

                    <div className="flex items-start gap-3 p-3 pr-2">
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                        {photoUrl
                          ? <img src={photoUrl} alt={place.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><MapPin size={20} className="text-slate-300" /></div>}
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
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {tags.slice(0, 2).map(id => {
                              const t = tagMap[id];
                              return t ? (
                                <span key={id} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                                  {t.emoji} {t.label}
                                </span>
                              ) : null;
                            })}
                            {tags.length > 2 && <span className="text-xs text-slate-400">+{tags.length - 2}</span>}
                          </div>
                        )}
                        {place.privateNotes && (
                          <p className="text-xs text-amber-600 mt-1 truncate italic">📝 {place.privateNotes}</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); setEditingPlace(place); }}
                          className="p-2 text-slate-300 hover:text-teal-500 transition-colors rounded-lg"
                          title="Edit tags & note"
                        >
                          <PencilLine size={16} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(place.placeId); }}
                          disabled={deletingId === place.placeId}
                          className="p-2 text-slate-300 hover:text-rose-400 transition-colors rounded-lg disabled:opacity-40"
                          title="Remove"
                        >
                          <Heart size={16} fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
