
import React from 'react';

// A touch-friendly range slider with a filled-progress track and a large
// thumb (styled by the `.tp-range` rules in index.html). The fill reflects the
// current value; pass a custom `trackStyle` for special tracks (e.g. the
// warm->cool color-temperature gradient) where progress fill isn't wanted.
type TileSliderProps = {
  value: number;
  min?: number;
  max?: number;
  /** CSS color for the filled portion + thumb ring. */
  accentColor?: string;
  /** Override the whole track background (skips the progress fill). */
  trackBackground?: string;
  disabled?: boolean;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCommit?: () => void;
};

const TileSlider = ({
  value,
  min = 0,
  max = 100,
  accentColor = 'rgb(var(--accent))',
  trackBackground,
  disabled,
  className = '',
  onChange,
  onCommit,
}: TileSliderProps) => {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const background =
    trackBackground ??
    `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${pct}%, rgb(var(--surface-control)) ${pct}%, rgb(var(--surface-control)) 100%)`;

  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={onChange}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      onClick={(e) => e.stopPropagation()}
      disabled={disabled}
      className={`tp-range w-full ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      style={{ background, ['--tp-thumb' as any]: accentColor }}
    />
  );
};

export default TileSlider;
