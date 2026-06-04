
import React from 'react';
import { IconBattery, IconBatteryLow, IconBatteryMedium, IconBatteryFull } from './icons';

interface BatteryIndicatorProps {
    level: number;
}

const BatteryIndicator = ({ level }: BatteryIndicatorProps) => {
    // Ensure level is within 0-100 range
    const safeLevel = Math.max(0, Math.min(100, Math.round(level)));

    let colorClass = 'text-gray-200';
    let Icon = IconBatteryFull;

    if (safeLevel <= 15) {
        colorClass = 'text-red-400';
        Icon = IconBatteryLow;
    } else if (safeLevel <= 30) {
        colorClass = 'text-yellow-400';
        Icon = IconBatteryMedium;
    } else if (safeLevel <= 80) {
        // Medium range
        Icon = IconBatteryMedium;
    }

    return (
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 shadow-md ${colorClass} justify-center`} title={`Battery: ${safeLevel}%`}>
            <Icon className="w-3 h-3" />
            <span className="text-xs font-semibold tabular-nums text-white">{safeLevel}%</span>
        </div>
    );
};

export default BatteryIndicator;
