import React from 'react';

interface HomeFabProps {
  visible: boolean;
  onClick: () => void;
}

const HomeFab: React.FC<HomeFabProps> = ({ visible, onClick }) => {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      aria-label="Go home"
      className="fixed bottom-6 inset-x-0 mx-auto w-16 h-16 bg-[#0052ff] rounded-full shadow-[0_8px_24px_rgba(0,82,255,0.35)] flex items-center justify-center text-white text-2xl z-40 active:scale-95 transition-transform"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
    </button>
  );
};

export default HomeFab;
