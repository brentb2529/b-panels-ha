/**
 * GlassCard — an elevated, spring-animated frosted glass card.
 *
 * Identical to GlassPanel but defaults to level-2 material (slightly more
 * transparent, higher blur) with card-sized corner radii. This is the right
 * component for individual zone tiles, info cards, and control groups.
 *
 * All GlassPanel props are forwarded; only the defaults differ.
 */

import React from 'react';
import { GlassPanel, type GlassPanelProps } from './GlassPanel';

export type GlassCardProps = GlassPanelProps;

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
    ({ level = 2, borderRadius = 'var(--radius-card)', ...rest }, ref) => (
        <GlassPanel ref={ref} level={level} borderRadius={borderRadius} {...rest} />
    )
);

GlassCard.displayName = 'GlassCard';

export default GlassCard;
