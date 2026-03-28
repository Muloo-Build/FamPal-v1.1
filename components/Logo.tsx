import React from 'react';

const Logo: React.FC<{ className?: string; size?: number; variant?: 'dark' | 'light' }> = ({ className = '', size = 40, variant = 'light' }) => {
  const src = variant === 'dark' ? '/favicon.png' : '/favicon-light.png';

  return (
    <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <img
        src={src}
        alt="FamPal"
        width={size}
        height={size}
        className="w-full h-full object-contain"
      />
    </div>
  );
};

export default Logo;
