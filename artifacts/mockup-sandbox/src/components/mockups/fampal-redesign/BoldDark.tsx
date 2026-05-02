import React from 'react';
import { MapPin, Search, Star, Compass, Bookmark, User, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function BoldDark() {
  const categories = ['All', 'Parks', 'Restaurants', 'Play Areas', 'Museums', 'Beaches'];
  
  const venues = [
    {
      id: 1,
      name: 'Green Point Park',
      category: 'Park',
      distance: '2.4 km',
      rating: 4.8,
      reviews: 1240,
      image: '/__mockup/images/fampal-bold-dark-park.png',
      description: 'Lush green space with kids play areas, picnic spots and walking paths.',
    },
    {
      id: 2,
      name: 'Two Oceans Aquarium',
      category: 'Museum',
      distance: '3.1 km',
      rating: 4.7,
      reviews: 3890,
      image: '/__mockup/images/fampal-bold-dark-aquarium.png',
      description: 'Stunning marine life exhibits, perfect for a family day out.',
    },
    {
      id: 3,
      name: 'Mojo Market',
      category: 'Restaurant',
      distance: '4.5 km',
      rating: 4.5,
      reviews: 892,
      image: '/__mockup/images/fampal-bold-dark-restaurant.png',
      description: 'Bustling food market with diverse options and live music.',
    }
  ];

  return (
    <div 
      className="bg-slate-950 text-slate-50 font-sans selection:bg-violet-500/30"
      style={{ width: 390, height: 844, overflow: 'hidden', position: 'relative', fontFamily: '"Inter", sans-serif' }}
    >
      {/* Top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-violet-600/20 blur-[100px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="px-6 pt-14 pb-4 relative z-10 flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">FamPals</h1>
        <div className="flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-full text-xs font-medium text-slate-300">
          <MapPin size={12} className="text-violet-400" />
          <span>Cape Town, 10km</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-6 relative z-10 mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input 
            type="text" 
            placeholder="Find places, activities..." 
            className="w-full bg-slate-900/60 border border-slate-800 text-slate-100 placeholder:text-slate-500 rounded-2xl py-4 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-all backdrop-blur-md"
          />
          <button className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-slate-800 text-slate-300 rounded-xl hover:text-white transition-colors">
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-6 relative z-10">
        <div className="flex gap-3 px-6 overflow-x-auto scrollbar-hide pb-2 snap-x">
          {categories.map((cat, i) => (
            <button 
              key={cat}
              className={`whitespace-nowrap px-5 py-2.5 rounded-2xl font-medium text-sm transition-all snap-start
                ${i === 0 
                  ? 'bg-violet-600 text-white shadow-[0_0_20px_rgba(124,58,237,0.3)] border border-violet-500' 
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Venue List */}
      <div className="px-6 pb-28 h-[calc(100%-240px)] overflow-y-auto scrollbar-hide relative z-10 flex flex-col gap-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-200 mb-1">Recommended for you</h2>
        
        {venues.map((venue) => (
          <div key={venue.id} className="group relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-800/60 transition-transform active:scale-[0.98]">
            {/* Image section */}
            <div className="relative h-48 w-full">
              <img 
                src={venue.image} 
                alt={venue.name} 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
              
              <div className="absolute top-4 left-4 bg-slate-950/60 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-semibold text-slate-200 border border-slate-800/50">
                {venue.category}
              </div>
              <button className="absolute top-4 right-4 p-2 bg-slate-950/60 backdrop-blur-md rounded-full text-slate-300 hover:text-white border border-slate-800/50">
                <Bookmark size={16} />
              </button>
            </div>

            {/* Content section */}
            <div className="relative p-5 -mt-8">
              <div className="flex justify-between items-end mb-2">
                <h3 className="text-xl font-bold text-white tracking-tight leading-tight">{venue.name}</h3>
                <div className="flex items-center gap-1 bg-violet-500/10 text-violet-400 px-2 py-1 rounded-lg">
                  <Star size={12} className="fill-violet-400" />
                  <span className="text-xs font-bold">{venue.rating}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-3">
                <MapPin size={12} />
                <span>{venue.distance}</span>
                <span className="w-1 h-1 rounded-full bg-slate-700 mx-1" />
                <span>{venue.reviews} reviews</span>
              </div>
              
              <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">
                {venue.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Nav */}
      <div className="absolute bottom-0 w-full px-6 pb-8 pt-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent z-20">
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-2 rounded-3xl flex justify-between items-center shadow-2xl">
          <button className="flex flex-col items-center justify-center w-1/3 py-2 text-violet-400">
            <div className="bg-violet-500/10 p-2 rounded-xl mb-1">
              <Compass size={22} className="stroke-[2.5]" />
            </div>
            <span className="text-[10px] font-bold">Explore</span>
          </button>
          
          <button className="flex flex-col items-center justify-center w-1/3 py-2 text-slate-500 hover:text-slate-300 transition-colors">
            <div className="p-2 mb-1">
              <Bookmark size={22} className="stroke-2" />
            </div>
            <span className="text-[10px] font-medium">Saved</span>
          </button>
          
          <button className="flex flex-col items-center justify-center w-1/3 py-2 text-slate-500 hover:text-slate-300 transition-colors">
            <div className="p-2 mb-1">
              <User size={22} className="stroke-2" />
            </div>
            <span className="text-[10px] font-medium">Profile</span>
          </button>
        </div>
      </div>
      
      {/* Global styles injected for hiding scrollbar */}
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
        .scrollbar-hide {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
