/**
 * NavRail — persistent left-side navigation for iPad-landscape (1366×1024).
 *
 * A 72px wide frosted-glass rail running the full height below the header.
 * Shows Home + area icons: Pool, Climate, Security, Lights.
 * Each button navigates to either:
 *   - /home  (Home overview)
 *   - /area/<areaKey>  (compilation panel full-screen route)
 *
 * Design language: liquid-glass, same material tokens as the tile system.
 * Active area indicator: a pill/accent stripe on the left edge.
 *
 * SECURITY ITEM: color-coded by real SecurityAlertLevel from useSecurityIndicator.
 *   clear  → standard accent (green dot badge)
 *   recent → amber icon + badge
 *   active → red icon + pulsing badge — impossible to miss
 */

import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  IconHome,
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconShieldCheck,
  IconAlertTriangle,
  IconLightbulb,
  IconZap,
} from './icons';
import { useSecurityIndicator } from '../hooks/useSecurityIndicator';
import { SECURITY_LEVEL_CONFIG } from './SecurityStatusIndicator';

interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'home',
    label: 'Home',
    path: '/home',
    icon: <IconHome className="w-6 h-6" />,
  },
  {
    key: 'pool',
    label: 'Pool',
    path: '/area/pool',
    icon: <IconWaves className="w-6 h-6" />,
  },
  {
    key: 'climate',
    label: 'Climate',
    path: '/area/climate',
    icon: <IconWind className="w-6 h-6" />,
  },
  {
    key: 'security',
    label: 'Security',
    path: '/area/security',
    icon: <IconShieldAlert className="w-6 h-6" />,
  },
  {
    key: 'lights',
    label: 'Lights',
    path: '/area/lights',
    icon: <IconLightbulb className="w-6 h-6" />,
  },
  {
    key: 'generator',
    label: 'Generator',
    path: '/area/generator',
    icon: <IconZap className="w-6 h-6" />,
  },
];

// NavRail animation keyframes (injected once)
const NAVRAIL_STYLE_ID = 'navrail-sec-anims';
if (typeof document !== 'undefined' && !document.getElementById(NAVRAIL_STYLE_ID)) {
  const s = document.createElement('style');
  s.id = NAVRAIL_STYLE_ID;
  s.textContent = `
@keyframes navrail-badge-pulse {
  0%, 100% { transform: scale(1);    opacity: 1; }
  50%       { transform: scale(1.35); opacity: 0.75; }
}
  `;
  document.head.appendChild(s);
}

const NavRail: React.FC = () => {
  const location = useLocation();

  // Security indicator — drives color of the Security nav item
  const secIndicator = useSecurityIndicator();
  const secCfg = SECURITY_LEVEL_CONFIG[secIndicator.level];

  return (
    <nav
      className="flex-none flex flex-col items-center py-3 gap-1 z-30"
      style={{
        width: 72,
        // Frosted glass: same material language as the header
        backgroundColor: 'rgb(var(--surface-raised) / 0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRight: 'var(--tile-border) 1px solid',
      }}
      aria-label="Area navigation"
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.path === '/home'
            ? location.pathname === '/home'
            : location.pathname.startsWith(item.path);

        const isSecurity = item.key === 'security';

        // Security item: override icon and color based on live alert level
        let itemColor: string;
        if (isSecurity) {
          itemColor = secCfg.accent;
        } else {
          itemColor = isActive
            ? 'rgb(var(--accent))'
            : 'rgb(var(--text) / 0.55)';
        }

        const secIcon = isSecurity
          ? (secIndicator.level === 'active'
              ? <IconAlertTriangle className="w-6 h-6" />
              : secIndicator.level === 'recent'
              ? <IconShieldAlert className="w-6 h-6" />
              : <IconShieldCheck className="w-6 h-6" />)
          : null;

        return (
          <NavLink
            key={item.key}
            to={item.path}
            title={isSecurity ? `Security: ${secIndicator.summary}` : item.label}
            aria-label={isSecurity ? `Security: ${secIndicator.summary}` : item.label}
            aria-current={isActive ? 'page' : undefined}
            className="relative flex flex-col items-center justify-center gap-1 rounded-xl transition-all select-none"
            style={{
              width: 56,
              height: 60,
              textDecoration: 'none',
              color: itemColor,
              backgroundColor: isActive
                ? (isSecurity
                    ? `color-mix(in srgb, ${secCfg.accent} 16%, transparent)`
                    : 'rgb(var(--accent) / 0.12)')
                : (isSecurity && secIndicator.level === 'active'
                    ? 'rgba(239, 68, 68, 0.08)'
                    : 'transparent'),
              // Left-edge accent stripe via box shadow
              boxShadow: isActive
                ? (isSecurity
                    ? `inset 3px 0 0 ${secCfg.accent}`
                    : 'inset 3px 0 0 rgb(var(--accent))')
                : 'none',
              transition: 'all 260ms ease',
            }}
          >
            {/* Icon — security item uses level-appropriate icon */}
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <span style={{ color: itemColor }}>
                {isSecurity ? secIcon : item.icon}
              </span>

              {/* Security badge dot */}
              {isSecurity && !secIndicator.isLoading && (
                <span style={{
                  position: 'absolute', top: -2, right: -3,
                  width: 8, height: 8, borderRadius: 999,
                  background: secCfg.accent,
                  border: '1.5px solid rgb(var(--surface-raised))',
                  animation: secIndicator.level === 'active'
                    ? 'navrail-badge-pulse 1.2s ease-in-out infinite'
                    : 'none',
                }} />
              )}
            </span>

            <span
              style={{
                fontSize: 10,
                fontWeight: isSecurity ? 700 : 600,
                letterSpacing: '0.02em',
                lineHeight: 1,
                color: itemColor,
                fontFamily: 'inherit',
              }}
            >
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
};

export default NavRail;
