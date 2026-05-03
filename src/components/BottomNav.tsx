import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Bookmark, User, MapPin } from 'lucide-react';

const tabs = [
  { path: '/', label: 'Explore', icon: Compass },
  { path: '/saved', label: 'Saved', icon: Bookmark },
  { path: '/profile', label: 'Profile', icon: User },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const loc = useLocation();

  const isActive = (path: string) =>
    path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(path);

  return (
    <>
      {/* ── Desktop sidebar ───────────────────────────────── */}
      <nav className="hidden md:flex fixed left-0 top-0 h-screen w-16 lg:w-56 flex-col bg-white border-r border-slate-100 z-50 shadow-sm">
        <div className="flex items-center gap-3 px-3 lg:px-4 h-16 border-b border-slate-100 shrink-0">
          <div className="w-8 h-8 bg-teal-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm shadow-teal-500/30">
            <MapPin size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="hidden lg:block font-bold text-slate-900 tracking-tight text-lg">FamPals</span>
        </div>
        <div className="flex flex-col gap-1 p-2 flex-1 pt-3">
          {tabs.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-all ${
                  active
                    ? 'bg-teal-50 text-teal-600'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                <span className="hidden lg:block text-sm font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Mobile bottom bar ─────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-slate-100"
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
    </>
  );
}
