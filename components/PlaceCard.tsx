import React from 'react';
import { Place } from '../types';
import AccessibilityBadges from '../src/components/AccessibilityBadges';
import { formatPriceLevel } from '../src/utils/priceLevel';

interface PlaceCardProps {
  place: Place;
  variant: 'hero' | 'list';
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClick: () => void;
  onAddToGroup?: () => void;
  showAddToGroup?: boolean;
  hasNotes?: boolean;
  isVisited?: boolean;
}

const PlaceCard: React.FC<PlaceCardProps> = ({ place, variant, isFavorite, onToggleFavorite, onClick, onAddToGroup, showAddToGroup, hasNotes, isVisited }) => {
  if (variant === 'hero') {
    return (
      <div
        onClick={onClick}
        className="min-w-[280px] h-[380px] overflow-hidden rounded-[36px] shadow-[0_26px_50px_rgba(24,0,82,0.12)] relative group shrink-0 cursor-pointer"
      >
        <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e255f]/92 via-[#0e255f]/28 to-transparent"></div>
        <div className="absolute top-5 left-5 h-24 w-24 rounded-full bg-white/10"></div>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className="absolute top-6 right-6 w-11 h-11 bg-white/28 backdrop-blur-md rounded-full flex items-center justify-center text-white"
        >
          <svg className={`w-5 h-5 transition-colors ${isFavorite ? 'fill-pink-400 stroke-pink-400' : 'stroke-white'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </button>

        <div className="absolute bottom-8 left-8 right-8 text-white space-y-2">
          <div className="flex gap-2">
            {place.tags.slice(0, 1).map((t) => (
              <span key={t} className="px-3 py-1 bg-[#ff8c00]/70 backdrop-blur-sm rounded-full text-[9px] font-extrabold uppercase tracking-[0.22em]">{t}</span>
            ))}
          </div>
          <h3 className="text-xl font-extrabold leading-tight">{place.name}</h3>
          <div className="flex items-center gap-3 text-[10px] font-bold text-white/70">
            <span className="flex items-center gap-1 text-[#ffcb84]"><svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg> {place.rating ?? '—'}</span>
            <span>•</span>
            <span>{place.distance}</span>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            <AccessibilityBadges accessibility={place.accessibility} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="stitch-card-soft p-3.5 flex gap-3 cursor-pointer active:scale-[0.98] transition-transform relative overflow-hidden"
    >
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#0052FF]/[0.05]"></div>
      <div className="w-20 h-20 rounded-[20px] overflow-hidden shrink-0 bg-slate-100">
        <img src={place.imageUrl} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center py-1">
        <div className="flex items-center gap-1.5">
          <h3 className="font-bold text-[15px] text-[#180052] truncate">{place.name}</h3>
          {isVisited && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Visited" />}
          {hasNotes && <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>}
        </div>
        <p className="text-slate-500 text-xs font-medium truncate">{place.description}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[#b35b00] text-xs font-bold flex items-center gap-0.5"><svg className="w-3 h-3 text-[#ff8c00]" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg> {place.rating ?? '—'}</span>
          <span className="text-slate-300 text-xs">{formatPriceLevel(place.priceLevel)}</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          <AccessibilityBadges accessibility={place.accessibility} />
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1 shrink-0">
        {showAddToGroup && onAddToGroup && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToGroup(); }}
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-[#0052FF] bg-[#e6f6ff] active:bg-[#d4efff]"
            aria-label="Add to circle"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${isFavorite ? 'text-rose-500 bg-rose-50' : 'text-slate-300 bg-slate-50'}`}
          aria-label={isFavorite ? 'Remove from saved' : 'Save place'}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
        </button>
      </div>
    </div>
  );
};

export default PlaceCard;
