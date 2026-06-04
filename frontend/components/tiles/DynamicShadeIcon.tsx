import React from 'react';

const DynamicShadeIcon = ({ level = 0 }: { level: number }) => {
  // level: 0 = closed, 100 = open
  const openPercentage = Math.max(0, Math.min(100, level)) / 100;
  
  const width = 48;
  const height = 48;
  const barCount = 8;
  
  // The portion of the window that is covered by the shade.
  // 1.0 when closed (level=0), 0.0 when open (level=100)
  const coveredPercentage = 1 - openPercentage;
  const shadeVisibleHeight = (height - 4) * coveredPercentage;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="48" height="48" aria-hidden="true">
      <defs>
        {/* A gradient for a simple sky background */}
        <linearGradient id="skyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#87CEEB', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#ADD8E6', stopOpacity: 1 }} />
        </linearGradient>

        {/* A subtle gradient for the shade material */}
        <linearGradient id="shadeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#2d2d2d', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#1e1e1e', stopOpacity: 1 }} />
        </linearGradient>
        
        {/* The clip path for the visible part of the shade */}
        <clipPath id="shade-clip-path">
          <rect x="2" y="2" width={width - 4} height={shadeVisibleHeight} />
        </clipPath>
      </defs>

      {/* Window Frame */}
      <rect x="0" y="0" width={width} height={height} rx="3" fill="#3e3e3e" />
      
      {/* "Outside" view (sky) */}
      <rect x="2" y="2" width={width - 4} height={height - 4} rx="2" fill="url(#skyGradient)" />
      
      {/* Shade Material, clipped to be visible only for the covered portion */}
      <g clipPath="url(#shade-clip-path)">
        <rect x="2" y="2" width={width - 4} height={height - 4} rx="2" fill="url(#shadeGradient)" />
        {/* More subtle horizontal lines for texture */}
        {Array.from({ length: barCount - 1 }).map((_, i) => (
          <line
            key={i}
            x1="2"
            y1={(i + 1) * ((height - 4) / barCount) + 2}
            x2={width - 2}
            y2={(i + 1) * ((height - 4) / barCount) + 2}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth="1"
          />
        ))}
      </g>
      
      {/* Pull Bar at the bottom of the visible shade */}
      {coveredPercentage > 0.05 && ( // Only show if shade is down a bit
         <rect 
            x="2" 
            y={2 + shadeVisibleHeight - 3} 
            width={width - 4} 
            height="4" 
            rx="1"
            fill="rgba(0,0,0,0.5)" 
        />
      )}
    </svg>
  );
};

export default DynamicShadeIcon;
