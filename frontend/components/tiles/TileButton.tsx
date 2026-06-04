
import React from 'react';
import { fluidTextSm, fluidPadY } from './tileScale';

// Variants give tile controls a single shared button language. `isActive` is
// kept for backward compatibility (equivalent to variant="primary" when true).
type TileButtonVariant = 'primary' | 'secondary' | 'ghost';

type TileButtonProps = {
  children: React.ReactNode;
  isActive?: boolean;
  variant?: TileButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

// Raised variants carry a top highlight + drop shadow so they read as
// physical, pressable controls; on press the shadow flips to an inset so the
// button visibly depresses (paired with active:scale below).
const VARIANT_CLASSES: Record<TileButtonVariant, string> = {
  primary: 'bg-brand-blue text-white hover:brightness-110 shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_2px_5px_-1px_rgb(0_0_0/0.4)] active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)]',
  secondary: 'bg-gray-600 hover:bg-gray-500 text-gray-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_2px_4px_-1px_rgb(0_0_0/0.35)] active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.3)]',
  ghost: 'bg-transparent hover:bg-gray-600/60 text-gray-200',
};

const TileButton = ({ children, isActive, variant, className = '', onClick, disabled, ...props }: TileButtonProps) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (onClick) {
      onClick(e);
    }
  };

  const resolvedVariant: TileButtonVariant = variant ?? (isActive ? 'primary' : 'secondary');

  const baseClasses = "flex items-center justify-center rounded-control font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-blue/50 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`${baseClasses} px-3 ${VARIANT_CLASSES[resolvedVariant]} ${className}`}
      style={{ ...fluidTextSm, ...fluidPadY(0.5) }}
      {...props}
    >
      {children}
    </button>
  );
};

export default TileButton;
