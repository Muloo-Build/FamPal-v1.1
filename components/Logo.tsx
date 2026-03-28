import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
  variant?: 'dark' | 'light';
  showWordmark?: boolean;
}

/**
 * FamPal logo — Kinship Modern identity.
 *
 * Mark: A bold location pin (FamPal blue) housing a warm family glyph
 * (two interlocking teardrop/person shapes in FamPal orange), symbolising
 * "family-first discovery".
 *
 * Wordmark: "fam" regular weight + "pal" bold, both in ink blue, tracking −0.02em.
 * When placed against a dark surface, pass variant="light" and the wordmark
 * switches to white.
 */
const Logo: React.FC<LogoProps> = ({
  className = '',
  size = 40,
  variant,
  showWordmark = false,
}) => {
  const wordmarkColor = variant === 'light' ? '#ffffff' : '#180052';

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {/* ── Icon mark ── */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        role="img"
      >
        <defs>
          {/* Main pin gradient: top-light → deep blue */}
          <linearGradient id="fp-pin-grad" x1="10" y1="2" x2="38" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1a6bff" />
            <stop offset="100%" stopColor="#003ec7" />
          </linearGradient>
          {/* Subtle inner glow for the white disc */}
          <filter id="fp-disc-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#003ec7" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* ── Pin body ── */}
        {/*
          Tall teardrop: circular head (r≈15) + tapered stem meeting at a point.
          The head centre sits at (24, 19); the tip meets at (24, 46).
        */}
        <path
          d="
            M24 2
            C13.51 2 5 10.51 5 21
            C5 29.28 9.82 36.34 15.14 41.34
            L22.82 48.46
            C23.51 49.1 24.49 49.1 25.18 48.46
            L32.86 41.34
            C38.18 36.34 43 29.28 43 21
            C43 10.51 34.49 2 24 2Z
          "
          fill="url(#fp-pin-grad)"
        />

        {/* ── White disc (inner plate) ── */}
        <circle cx="24" cy="20" r="11.5" fill="white" filter="url(#fp-disc-shadow)" />

        {/*
          ── Family glyph ──
          Two "person" forms rendered as head-circle + shoulder-arc, scaled to
          fit inside the white disc. Adult (left, larger) + child (right, smaller).
          Both in FamPal orange (#FF8C00).

          Adult: head cx=21 cy=16.5 r=3; body arc below
          Child:  head cx=28 cy=17.5 r=2.2; body arc below
        */}

        {/* Adult — head */}
        <circle cx="21" cy="16" r="3" fill="#FF8C00" />
        {/* Adult — shoulders / body */}
        <path
          d="M15 26 C15 22.13 17.69 20 21 20 C24.31 20 27 22.13 27 26"
          fill="#FF8C00"
        />

        {/* Child — head */}
        <circle cx="28.5" cy="17" r="2.2" fill="#FF8C00" opacity="0.9" />
        {/* Child — shoulders / body */}
        <path
          d="M24 26 C24 23.24 25.96 21.5 28.5 21.5 C31.04 21.5 33 23.24 33 26"
          fill="#FF8C00"
          opacity="0.9"
        />

        {/* ── Subtle pin-tip highlight dot ── */}
        <circle cx="24" cy="45.5" r="1.5" fill="#003ec7" opacity="0.5" />
      </svg>

      {/* ── Wordmark ── */}
      {showWordmark && (
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: size * 0.52,
            letterSpacing: '-0.025em',
            lineHeight: 1,
            color: wordmarkColor,
            userSelect: 'none',
          }}
        >
          <span style={{ fontWeight: 500 }}>fam</span>
          <span style={{ fontWeight: 800 }}>pal</span>
        </span>
      )}
    </div>
  );
};

export default Logo;
