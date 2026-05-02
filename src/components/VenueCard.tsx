import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, MapPin, Heart } from 'lucide-react';
import type { Venue } from '../../types';

interface Props {
  venue: Venue;
  isSaved?: boolean;
  onToggleSave?: (venue: Venue) => void;
}

function categoryLabel(types: string[]): string {
  const map: Record<string, string> = {
    park: 'Park',
    restaurant: 'Restaurant',
    cafe: 'Café',
    museum: 'Museum',
    aquarium: 'Aquarium',
    zoo: 'Zoo',
    amusement_park: 'Amusement Park',
    shopping_mall: 'Mall',
    movie_theater: 'Cinema',
    library: 'Library',
    bowling_alley: 'Bowling',
    stadium: 'Stadium',
    beach: 'Beach',
    natural_feature: 'Nature',
  };
  for (const t of types) {
    if (map[t]) return map[t];
  }
  if (types.includes('food') || types.includes('meal_takeaway')) return 'Restaurant';
  if (types.includes('point_of_interest')) return 'Attraction';
  return 'Place';
}

export default function VenueCard({ venue, isSaved, onToggleSave }: Props) {
  const navigate = useNavigate();
  const photoUrl = venue.photoReference
    ? `/api/places/photo?photoReference=${encodeURIComponent(venue.photoReference)}&maxWidth=600`
    : null;

  return (
    <div
      onClick={() => navigate(`/venue/${venue.placeId}`)}
      className="bg-white rounded-3xl overflow-hidden shadow-[0_4px_24px_rgb(0,0,0,0.06)] border border-slate-100/50 active:scale-[0.98] transition-transform cursor-pointer"
    >
      <div className="relative h-48 bg-slate-100">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={venue.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100">
            <MapPin size={32} className="text-teal-300" />
          </div>
        )}

        {onToggleSave && (
          <button
            onClick={e => { e.stopPropagation(); onToggleSave(venue); }}
            className={`absolute top-3 right-3 p-2.5 rounded-full backdrop-blur-md shadow-sm transition-colors ${
              isSaved
                ? 'bg-rose-500 text-white'
                : 'bg-white/90 text-slate-400 hover:text-rose-400'
            }`}
          >
            <Heart size={18} fill={isSaved ? 'currentColor' : 'none'} />
          </button>
        )}

        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-xl shadow-sm border border-black/5">
          <span className="text-xs font-semibold text-slate-700 tracking-wide uppercase">
            {venue.category || categoryLabel(venue.types)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-between items-start mb-1.5">
          <h3 className="text-[17px] font-bold text-slate-900 leading-tight pr-3 flex-1">
            {venue.name}
          </h3>
          {venue.rating && (
            <div className="flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg shrink-0">
              <Star size={13} className="fill-amber-400 text-amber-400" />
              <span className="text-sm font-bold text-amber-700">{venue.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        <p className="text-slate-500 text-sm mb-3 line-clamp-1">{venue.vicinity}</p>

        {venue.distance && (
          <div className="flex items-center gap-1.5 text-sm font-medium text-teal-600">
            <MapPin size={15} />
            <span>{venue.distance} away</span>
          </div>
        )}
      </div>
    </div>
  );
}
