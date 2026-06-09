/**
 * NavRail — persistent left-side navigation for iPad-landscape (1366×1024).
 *
 * A 72px wide frosted-glass rail running the full height below the header.
 * Shows Home + area icons filtered to the ACTIVE PANEL's scope.
 * Each button navigates to either:
 *   - /home  (Home overview)
 *   - /area/<areaKey>  (compilation panel full-screen route)
 *
 * Footer: PanelSwitcher control for switching between scoped panels.
 *
 * Design language: liquid-glass, same material tokens as the tile system.
 * Active area indicator: a pill/accent stripe on the left edge.
 *
 * Scope filtering: controlled by useScopedPanel(). Only items whose key is in
 * activePanelDef.scope are shown. The underlying routes/components are NOT
 * deleted — they are simply not navigable from this rail.
 */

import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  IconHome,
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconZap,
} from './icons';
import { useScopedPanel } from '../hooks/useScopedPanel';
import PanelSwitcher from './PanelSwitcher';

interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

const ALL_NAV_ITEMS: NavItem[] = [
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

const NavRail: React.FC = () => {
  const location = useLocation();
  const { isAreaAllowed } = useScopedPanel();

  // Filter nav items to only those within the active panel's scope.
  const visibleItems = ALL_NAV_ITEMS.filter(item => isAreaAllowed(item.key));

  return (
    <nav
      className="flex-none flex flex-col items-center py-3 z-30"
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
      {/* Scoped nav items */}
      <div className="flex flex-col items-center gap-1 flex-1">
        {visibleItems.map((item) => {
          const isActive =
            item.path === '/home'
              ? location.pathname === '/home'
              : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.key}
              to={item.path}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-col items-center justify-center gap-1 rounded-xl transition-all select-none"
              style={{
                width: 56,
                height: 60,
                textDecoration: 'none',
                color: isActive
                  ? 'rgb(var(--accent))'
                  : 'rgb(var(--text) / 0.55)',
                backgroundColor: isActive
                  ? 'rgb(var(--accent) / 0.12)'
                  : 'transparent',
                // Left-edge accent stripe via box shadow
                boxShadow: isActive
                  ? 'inset 3px 0 0 rgb(var(--accent))'
                  : 'none',
              }}
            >
              {item.icon}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {item.label}
              </span>
            </NavLink>
          );
        })}
      </div>

      {/* Footer: panel switcher — lets the user switch named scoped views */}
      <div
        style={{
          width: '100%',
          borderTop: '1px solid rgb(var(--text) / 0.08)',
          paddingTop: 6,
          paddingBottom: 4,
          paddingLeft: 4,
          paddingRight: 4,
        }}
      >
        <PanelSwitcher />
      </div>
    </nav>
  );
};

export default NavRail;
