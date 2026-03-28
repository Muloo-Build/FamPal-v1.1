import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
  variant?: 'dark' | 'light';
  showWordmark?: boolean;
}

const Logo: React.FC<LogoProps> = ({ className = '', size = 40, showWordmark = false }) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    {/* Icon mark */}
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="FamPals"
    >
      {/* Pin body */}
      <path
        d="M24 4C16.268 4 10 10.268 10 18c0 11 14 26 14 26s14-15 14-26c0-7.732-6.268-14-14-14z"
        fill="#0052FF"
      />
      {/* Pin highlight */}
      <path
        d="M24 4C16.268 4 10 10.268 10 18c0 2.8.7 5.4 1.9 7.7C13.4 9.6 22 6 24 4z"
        fill="#3B82F6"
        opacity="0.4"
      />
      {/* Inner circle */}
      <circle cx="24" cy="18" r="8" fill="white" />
      {/* Child figure — head */}
      <circle cx="24" cy="14.5" r="2.2" fill="#FF8C00" />
      {/* Child figure — body */}
      <path
        d="M21 18.5c0-1.657 1.343-3 3-3s3 1.343 3 3v3.5h-6v-3.5z"
        fill="#FF8C00"
      />
      {/* Arms spread (joy) */}
      <path d="M18.5 19.5l2.5 1" stroke="#FF8C00" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M29.5 19.5l-2.5 1" stroke="#FF8C00" strokeWidth="1.5" strokeLinecap="round" />
      {/* Pin tip dot */}
      <circle cx="24" cy="44" r="1.5" fill="#003EC7" />
    </svg>

    {/* Wordmark — only shown when showWordmark is true */}
    {showWordmark && (
      <span
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: size * 0.55, color: '#180052', letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        FamPals
      </span>
    )}
  </div>
);

export default Logo;
