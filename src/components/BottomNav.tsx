import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Bookmark, User } from 'lucide-react';

const tabs = [
  { path: '/', label: 'Explore', icon: Compass },
  { path: '/saved', label: 'Saved', icon: Bookmark },
  { path: '/profile', label: 'Profile', icon: User },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-slate-100"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}
    >
      <div className="flex justify-around items-center pt-3 pb-2 px-4">
        {tabs.map(({ path, label, icon: Icon }) => {
          const active = isActive(path);
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center gap-1 min-w-[64px] transition-colors ${
                active ? 'text-teal-600' : 'text-slate-400'
              }`}
            >
              <div className={`p-1.5 rounded-xl transition-colors ${active ? 'bg-teal-50' : ''}`}>
                <Icon size={24} strokeWidth={active ? 2.5 : 2} />
              </div>
              <span className={`text-[11px] font-${active ? 'semibold' : 'medium'}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
