import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface NavButtonProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    aria-label={label}
    className="flex flex-col items-center gap-1 min-w-[60px] py-1 transition-all active:scale-95"
  >
    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
      active
        ? 'bg-[#0052ff] shadow-[0_4px_14px_rgba(0,82,255,0.32)]'
        : 'bg-transparent'
    }`}>
      <Icon
        size={20}
        strokeWidth={active ? 2.5 : 1.8}
        className={active ? 'text-white' : 'text-[#94a3b8]'}
      />
    </div>
    <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors ${
      active ? 'text-[#0052ff]' : 'text-[#94a3b8]'
    }`}>
      {label}
    </span>
  </button>
);

export default NavButton;
