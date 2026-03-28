import React from 'react';
import { ExploreIntent } from '../types';

interface FiltersProps {
  selected: ExploreIntent;
  onChange: (type: ExploreIntent) => void;
}

const CATEGORY_EMOJI: Record<string, string> = {
  all: '✦',
  eat_drink: '🍽️',
  play_kids: '🎡',
  outdoors: '🌿',
  things_to_do: '🎯',
  sport_active: '⚡',
  indoor: '🏠',
};

const Filters: React.FC<FiltersProps> = ({ selected, onChange }) => {
  const categories: { id: ExploreIntent; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'eat_drink', label: 'Eat & Drink' },
    { id: 'play_kids', label: 'Play & Kids' },
    { id: 'outdoors', label: 'Outdoors' },
    { id: 'things_to_do', label: 'Things To Do' },
    { id: 'sport_active', label: 'Sport & Active' },
    { id: 'indoor', label: 'Indoor' },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar py-3 -mx-5 px-5">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`flex items-center gap-1.5 shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
            selected === cat.id
              ? 'bg-[#0052FF] text-white shadow-md shadow-blue-200'
              : 'bg-white text-slate-600 border border-slate-100 shadow-sm'
          }`}
        >
          <span className="text-base leading-none">{CATEGORY_EMOJI[cat.id] ?? '•'}</span>
          <span>{cat.label}</span>
        </button>
      ))}
    </div>
  );
};

export default Filters;
