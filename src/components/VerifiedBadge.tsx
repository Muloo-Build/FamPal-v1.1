import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface VerifiedBadgeProps {
  size?: 'sm' | 'md';
  label?: string;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({ size = 'md', label = 'Verified' }) => {
  const isSmall = size === 'sm';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-bold ${
      isSmall
        ? 'px-2 py-0.5 text-[9px]'
        : 'px-2.5 py-1 text-[10px]'
    } bg-[#0052ff] text-white shadow-[0_2px_8px_rgba(0,82,255,0.30)]`}>
      <ShieldCheck size={isSmall ? 9 : 11} strokeWidth={2.5} />
      {label}
    </span>
  );
};

export const MulooVerifiedBadge: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'sm' }) => (
  <VerifiedBadge size={size} label="Muloo Verified" />
);
