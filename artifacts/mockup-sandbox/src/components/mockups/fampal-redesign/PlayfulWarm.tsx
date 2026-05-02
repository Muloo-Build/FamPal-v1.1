import React, { useState } from "react";
import { Search, MapPin, Heart, Compass, User, Star } from "lucide-react";

export function PlayfulWarm() {
  const [activeTab, setActiveTab] = useState("Explore");
  const [activeFilter, setActiveFilter] = useState("All");

  const filters = [
    { name: "All", emoji: "✨" },
    { name: "Parks", emoji: "🌳" },
    { name: "Restaurants", emoji: "🍕" },
    { name: "Play Areas", emoji: "🎈" },
    { name: "Museums", emoji: "🎨" },
    { name: "Beaches", emoji: "🏖️" },
  ];

  const venues = [
    {
      id: 1,
      name: "Sunny Meadows Park",
      category: "Parks",
      distance: "2.3 km",
      rating: 4.8,
      reviews: 124,
      image: "/__mockup/images/fp-park.jpg",
      description: "Huge playground with splash pads and picnic spots.",
      color: "bg-[#FFB067]", // Amber
    },
    {
      id: 2,
      name: "The Happy Bean Cafe",
      category: "Restaurants",
      distance: "3.5 km",
      rating: 4.6,
      reviews: 89,
      image: "/__mockup/images/fp-cafe.jpg",
      description: "Kid-friendly menu, changing tables, and a small play corner.",
      color: "bg-[#FF8575]", // Coral
    },
    {
      id: 3,
      name: "Wonder Discovery Center",
      category: "Museums",
      distance: "5.1 km",
      rating: 4.9,
      reviews: 312,
      image: "/__mockup/images/fp-museum.jpg",
      description: "Interactive science exhibits perfect for toddlers to teens.",
      color: "bg-[#FFD35A]", // Sunshine Yellow
    },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');
        .playful-font { font-family: 'Quicksand', sans-serif; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div 
        className="playful-font bg-[#FFF9F2] text-[#4A3D3D] mx-auto overflow-hidden relative shadow-2xl"
        style={{ width: 390, height: 844 }}
      >
        {/* Header Section */}
        <div className="pt-14 pb-4 px-6 bg-[#FFF9F2] rounded-b-[40px] shadow-sm z-10 relative">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-[#FF8575] tracking-tight">FamPals</h1>
            <div className="flex items-center gap-1.5 bg-[#FFEFE5] px-3 py-1.5 rounded-full text-sm font-semibold text-[#FF8575]">
              <MapPin size={16} strokeWidth={2.5} />
              <span>Cape Town, 10km</span>
            </div>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-[#FFB067]" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              placeholder="Find a place to go..."
              className="w-full bg-white border-2 border-[#FFE8D6] rounded-full py-4 pl-12 pr-4 text-base font-medium placeholder:text-[#D1C4C4] focus:outline-none focus:border-[#FFB067] focus:ring-4 focus:ring-[#FFB067]/20 transition-all shadow-[0_4px_10px_rgba(255,176,103,0.1)]"
            />
          </div>

          {/* Filters */}
          <div className="flex overflow-x-auto hide-scrollbar gap-3 -mx-6 px-6 pb-2">
            {filters.map((filter) => (
              <button
                key={filter.name}
                onClick={() => setActiveFilter(filter.name)}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-full font-bold text-sm transition-transform active:scale-95 shadow-sm ${
                  activeFilter === filter.name
                    ? "bg-[#FFD35A] text-[#6A4D00] border-2 border-[#E5B53D]"
                    : "bg-white text-[#8A7D7D] border-2 border-[#F0E6E6] hover:bg-[#FFF9F2]"
                }`}
              >
                <span className="text-lg">{filter.emoji}</span>
                {filter.name}
              </button>
            ))}
          </div>
        </div>

        {/* List Section */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-6 pt-6 pb-28 space-y-5 h-full">
          {venues.map((venue) => (
            <div 
              key={venue.id} 
              className="bg-white rounded-[32px] overflow-hidden shadow-[0_8px_20px_rgba(138,125,125,0.08)] border-2 border-[#FFF0E6] transform transition-transform active:scale-[0.98]"
            >
              <div className="relative h-[180px]">
                <img
                  src={venue.image}
                  alt={venue.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-2.5 rounded-full shadow-md text-[#FF8575]">
                  <Heart size={20} strokeWidth={2.5} />
                </div>
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-md text-xs font-bold text-[#4A3D3D] flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-[#FFD35A]"></span>
                  {venue.category}
                </div>
              </div>
              <div className="p-5 relative">
                <div className={`absolute -top-6 right-5 ${venue.color} text-white px-3 py-1.5 rounded-2xl font-bold text-sm flex items-center gap-1 shadow-lg border-2 border-white`}>
                  <MapPin size={14} strokeWidth={3} />
                  {venue.distance}
                </div>
                
                <h3 className="text-xl font-bold mb-1.5 text-[#4A3D3D]">{venue.name}</h3>
                
                <div className="flex items-center gap-3 mb-3 text-sm font-semibold">
                  <div className="flex items-center gap-1 text-[#FFB067]">
                    <Star size={16} fill="currentColor" />
                    <span>{venue.rating}</span>
                  </div>
                  <span className="text-[#D1C4C4]">•</span>
                  <span className="text-[#8A7D7D]">{venue.reviews} reviews</span>
                </div>
                
                <p className="text-[#8A7D7D] text-sm leading-relaxed font-medium">
                  {venue.description}
                </p>
              </div>
            </div>
          ))}
          <div className="h-6"></div>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 inset-x-0 bg-white border-t-2 border-[#F5EBEB] px-8 py-5 flex justify-between items-center rounded-t-[40px] shadow-[0_-10px_20px_rgba(138,125,125,0.05)] pb-8">
          {[
            { id: "Explore", icon: Compass },
            { id: "Saved", icon: Heart },
            { id: "Profile", icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex flex-col items-center gap-1.5 relative"
              >
                {isActive && (
                  <div className="absolute -top-4 w-1.5 h-1.5 bg-[#FF8575] rounded-full"></div>
                )}
                <div className={`p-2.5 rounded-2xl transition-colors ${isActive ? 'bg-[#FFEFE5] text-[#FF8575]' : 'text-[#B8ACAC]'}`}>
                  <Icon size={26} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={`text-[11px] font-bold ${isActive ? 'text-[#FF8575]' : 'text-[#B8ACAC]'}`}>
                  {tab.id}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
