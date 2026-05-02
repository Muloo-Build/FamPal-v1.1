import React, { useState } from "react";
import { Search, MapPin, Star, Heart, Compass, Bookmark, User } from "lucide-react";

export function CleanLight() {
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = ["All", "Parks", "Restaurants", "Play Areas", "Museums", "Beaches"];

  const venues = [
    {
      id: 1,
      name: "Green Point Urban Park",
      category: "Parks",
      distance: "2.1 km",
      rating: 4.8,
      reviews: 324,
      image: "/__mockup/images/park-1.jpg",
      description: "Expansive green space with an adventure playground, biodiversity garden, and picnic spots.",
    },
    {
      id: 2,
      name: "The Company's Garden Restaurant",
      category: "Restaurants",
      distance: "3.5 km",
      rating: 4.5,
      reviews: 189,
      image: "/__mockup/images/restaurant-1.jpg",
      description: "Relaxed outdoor dining with giant chess, hanging nests, and plenty of space for kids.",
    },
    {
      id: 3,
      name: "Two Oceans Aquarium",
      category: "Museums",
      distance: "4.2 km",
      rating: 4.9,
      reviews: 512,
      image: "/__mockup/images/museum-1.jpg",
      description: "Fascinating marine life exhibits with interactive touch pools and penguin feeding.",
    }
  ];

  return (
    <div 
      style={{ 
        width: 390, 
        height: 844, 
        overflow: 'hidden', 
        position: 'relative',
        backgroundColor: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      }}
      className="flex flex-col shadow-2xl rounded-[40px] border-[8px] border-black/10"
    >
      {/* Header */}
      <header className="pt-14 pb-4 px-6 bg-white/80 backdrop-blur-xl border-b border-slate-100 z-10 sticky top-0">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">FamPals</h1>
          <div className="flex items-center gap-1.5 bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full text-sm font-medium">
            <MapPin size={14} className="text-teal-600" />
            <span>Cape Town, 10km</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={18} className="text-slate-400" />
          </div>
          <input 
            type="text" 
            placeholder="Find places to go..." 
            className="w-full bg-slate-100/80 border-0 text-slate-900 rounded-2xl py-3.5 pl-11 pr-4 focus:ring-2 focus:ring-teal-500/30 focus:outline-none transition-all placeholder:text-slate-500 font-medium"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-hide">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`whitespace-nowrap px-5 py-2.5 rounded-full text-sm font-semibold transition-all shadow-sm ${
                activeCategory === category 
                  ? "bg-teal-600 text-white shadow-teal-500/20" 
                  : "bg-white text-slate-600 border border-slate-200/60 hover:bg-slate-50"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-28 px-6 pt-6">
        <div className="flex flex-col gap-6">
          {venues.map(venue => (
            <div key={venue.id} className="bg-white rounded-3xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/50 group">
              <div className="relative h-48 w-full bg-slate-200">
                <img 
                  src={venue.image} 
                  alt={venue.name}
                  className="w-full h-full object-cover"
                />
                <button className="absolute top-4 right-4 p-2.5 bg-white/90 backdrop-blur-md rounded-full text-slate-400 hover:text-red-500 transition-colors shadow-sm">
                  <Heart size={20} />
                </button>
                <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-sm border border-black/5">
                  <span className="text-xs font-semibold text-slate-800 tracking-wide uppercase">{venue.category}</span>
                </div>
              </div>
              <div className="p-5">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-[19px] font-bold text-slate-900 leading-tight pr-4">{venue.name}</h3>
                  <div className="flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg shrink-0">
                    <Star size={14} className="fill-amber-400 text-amber-400" />
                    <span className="text-sm font-bold text-amber-700">{venue.rating}</span>
                  </div>
                </div>
                <p className="text-slate-500 text-[15px] leading-relaxed mb-4 line-clamp-2">
                  {venue.description}
                </p>
                <div className="flex items-center gap-1.5 text-sm font-medium text-teal-600">
                  <MapPin size={16} />
                  <span>{venue.distance} away</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Nav */}
      <nav className="absolute bottom-0 w-full bg-white/90 backdrop-blur-xl border-t border-slate-100 pb-8 pt-4 px-8 flex justify-between items-center z-20">
        <button className="flex flex-col items-center gap-1 text-teal-600">
          <div className="p-1.5 bg-teal-50 rounded-xl">
            <Compass size={24} strokeWidth={2.5} />
          </div>
          <span className="text-[11px] font-semibold">Explore</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors">
          <div className="p-1.5">
            <Bookmark size={24} strokeWidth={2} />
          </div>
          <span className="text-[11px] font-medium">Saved</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors">
          <div className="p-1.5">
            <User size={24} strokeWidth={2} />
          </div>
          <span className="text-[11px] font-medium">Profile</span>
        </button>
      </nav>
    </div>
  );
}
