import React, { useState } from 'react';
import Logo from './Logo';
import { User } from '../types';

interface HeaderProps {
  setView: (view: string) => void;
  user: User | null;
  locationName: string;
  onSearch?: (query: string) => void;
  onLocationChange?: (postcode: string) => void;
}

const Header: React.FC<HeaderProps> = ({ setView, user, locationName, onSearch, onLocationChange }) => {
  const userPhoto = user?.photoURL || 'https://picsum.photos/seed/guest/100';
  const [searchQuery, setSearchQuery] = useState('');
  const [showLocationInput, setShowLocationInput] = useState(false);
  const [postcodeInput, setPostcodeInput] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);

  const handleSearch = () => {
    if (onSearch) {
      onSearch(searchQuery.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (onSearch) {
      onSearch('');
    }
  };

  const handleLocationSubmit = async () => {
    if (onLocationChange && postcodeInput.trim()) {
      setLocationLoading(true);
      await onLocationChange(postcodeInput.trim());
      setLocationLoading(false);
      setShowLocationInput(false);
      setPostcodeInput('');
    }
  };

  return (
    <header className="px-4 pt-6 pb-4 stitch-header-glass sticky top-0 z-50">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="rounded-[18px] bg-[linear-gradient(135deg,#003ec7_0%,#0052ff_100%)] p-1.5 shadow-[0_18px_26px_rgba(0,82,255,0.18)]">
              <Logo size={38} className="rounded-xl" />
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.28em] leading-none mb-1">Family Concierge</p>
              <button
                onClick={() => setShowLocationInput(!showLocationInput)}
                className="text-lg font-black stitch-editorial-title flex items-center gap-1 leading-none hover:text-[#0052FF] transition-colors"
              >
                {locationName} <span className="text-[#FF8C00] text-xs">•</span>
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>
          <button
            onClick={() => setView('profile')}
            className="w-11 h-11 rounded-full overflow-hidden ring-4 ring-white/70 shadow-[0_16px_24px_rgba(24,0,82,0.08)]"
          >
            <img src={userPhoto} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
        </div>

        {showLocationInput && (
          <div className="stitch-card-soft p-4 animate-slide-up">
            <p className="text-xs font-bold text-[#0052FF] mb-2 uppercase tracking-[0.18em]">Enter postcode or address</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. SW1A 1AA or London"
                value={postcodeInput}
                onChange={e => setPostcodeInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLocationSubmit()}
                className="stitch-input flex-1 h-12 px-4 font-semibold text-sm"
              />
              <button
                onClick={handleLocationSubmit}
                disabled={locationLoading}
                className="stitch-pill-button px-5 h-12 font-black text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {locationLoading ? '...' : 'Set'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <div className="flex items-center gap-2 absolute inset-y-0 left-4 pointer-events-none">
              {/* AI indicator badge */}
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0052ff]/10 border border-[#0052ff]/20">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" fill="#0052ff" opacity="0.3"/>
                  <circle cx="5" cy="5" r="2" fill="#0052ff"/>
                </svg>
                <span className="text-[9px] font-black text-[#0052ff] uppercase tracking-wider">AI</span>
              </div>
              <svg className="w-4 h-4 text-[#0052FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder='Ask anything — "wine farm with a playground near me"'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="stitch-input w-full h-14 pl-28 pr-12 font-semibold text-sm"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute inset-y-0 right-4 flex items-center text-slate-400 hover:text-slate-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            className="stitch-pill-button w-14 h-14 flex items-center justify-center active:scale-95 transition-transform"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
