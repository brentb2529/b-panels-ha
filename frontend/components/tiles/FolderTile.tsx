
import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Device, TileConfig, DeviceType } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import { IconFolder, getIcon } from '../icons';
import TileWrapper, { TileAccent } from './TileWrapper';
import { fluidIcon } from './tileScale';
import UnknownTile from './UnknownTile';

// Helper to determine if a device is considered "active" for animation purposes
// matching the logic in individual tile components
const isDeviceActive = (device: Device, tileConfig: TileConfig): boolean => {
    // 1. Check for inversion (Switch-like devices mostly)
    let inverted = false;
    if (tileConfig.displayOverride?.invertState) {
        // Only Switch-like tiles typically support override in their implementation
        if ([
            DeviceType.Switch, 
            DeviceType.Light, 
            DeviceType.SmartPlug, 
            DeviceType.Siren, 
            DeviceType.Virtual, 
            DeviceType.Lock, 
            DeviceType.Valve, 
            DeviceType.Scene
        ].includes(device.type)) {
            inverted = true;
        }
    }

    let active = false;

    switch (device.type) {
        case DeviceType.Switch:
        case DeviceType.Light:
        case DeviceType.SmartPlug:
        case DeviceType.Siren:
        case DeviceType.Virtual:
        case DeviceType.Lock: // SwitchTile logic: active = state (locked)
        case DeviceType.Valve: // SwitchTile logic: active = state (open)
        case DeviceType.Scene:
            active = !!device.state;
            break;
        
        case DeviceType.Dimmer:
        case DeviceType.Shade:
            // DimmerTile/ShadeTile currently ignore displayOverride.invertState
            active = (typeof device.state === 'number' && device.state > 0);
            break;

        case DeviceType.MotionSensor:
        case DeviceType.ContactSensor:
        case DeviceType.OccupancySensor:
        case DeviceType.SmokeDetector:
        case DeviceType.CarbonMonoxideDetector:
            // SensorTile currently ignores displayOverride.invertState
            active = !!device.state;
            break;

        case DeviceType.WaterSensor:
            active = (device.state as any)?.leak === true;
            break;

        case DeviceType.PanicButton:
            active = device.state !== 'IDLE';
            break;

        case DeviceType.Generator:
            active = (device.state as any)?.active === true;
            break;
            
        case DeviceType.SonosPlayer:
             active = (device.state as any)?.playbackState === 'PLAYING';
             break;

        default:
            active = !!device.state;
    }

    return inverted ? !active : active;
};

const FolderTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
  const location = useLocation();
  const { panels, deviceMap } = useDashboard();
  
  // The new synthetic device logic in useDashboard ensures the state will be a well-formed object.
  const panelId: string | null = (device.state && typeof device.state === 'object' && (device.state as any).panelId) || null;
  const isLocked = !!tile.isLocked;

  if (!panelId) {
    return <UnknownTile tile={tile} device={device} isEditor={isEditor} cornerClassName={cornerClassName} />;
  }

  // Calculate Alert Status and Animations by looking inside the target panel
  const { status: alertStatus, animation: bubbledAnimation, count: itemCount } = useMemo(() => {
      const targetPanel = panels.find(p => p.id === panelId);
      if (!targetPanel) return { status: null, animation: null, count: 0 };
      const count = targetPanel.tiles.length;

      let hasLeak = false;
      let hasDanger = false; // Smoke, CO, Intrusion
      let foundAnimation = null;

      for (const t of targetPanel.tiles) {
          const d = deviceMap.get(t.deviceId);
          if (!d) continue;

          // Water Leak — HA binary_sensor maps to a boolean; the legacy
          // SmartThings path used { leak }. Accept either so a contained HA
          // leak sensor still bounces the folder when wet.
          if (d.type === DeviceType.WaterSensor && (d.state === true || (d.state as any)?.leak === true)) {
              hasLeak = true;
          }
          
          // Danger / Critical Alerts
          if (d.type === DeviceType.SmokeDetector && d.state === true) {
              hasDanger = true;
          }
          if (d.type === DeviceType.CarbonMonoxideDetector && d.state === true) {
              hasDanger = true;
          }
          if (d.type === DeviceType.AlarmPanel && (d.state as any)?.securityState === 'VIOLATION') {
               hasDanger = true;
          }

          // Check for bubbling animation from children
          if (!foundAnimation && t.animation?.enabled) {
              if (isDeviceActive(d, t)) {
                  foundAnimation = t.animation;
              }
          }
      }

      if (hasDanger) return { status: 'danger', animation: null, count };
      if (hasLeak) return { status: 'leak', animation: null, count };

      return { status: null, animation: foundAnimation, count };
  }, [panels, panelId, deviceMap]);

  // Determine visual overrides based on alert status
  let iconColor = "text-yellow-400";
  let accent: TileAccent = 'brand';
  let activeAnimation = tile.animation; // Default to user config for the folder itself
  let isActive = false; // Determines if animation is shown by TileWrapper

  if (alertStatus === 'leak') {
      iconColor = "text-blue-400";
      accent = 'water';
      isActive = true;
      // Bounce blue for water
      activeAnimation = { enabled: true, effect: 'bounce', color: '#3b82f6' };
  } else if (alertStatus === 'danger') {
      iconColor = "text-red-500";
      accent = 'alert';
      isActive = true;
      // Pulse red for danger
      activeAnimation = { enabled: true, effect: 'pulse', color: '#ef4444' };
  } else if (bubbledAnimation) {
      // Inherit animation from child
      isActive = true;
      activeAnimation = bubbledAnimation;
  }

  const iconProps = { className: `${iconColor} transition-colors duration-300`, style: fluidIcon(3) };
  const customIcon = tile.folderIcon ? getIcon(tile.folderIcon, iconProps) : null;
  const iconToRender = customIcon || <IconFolder {...iconProps} />;

  const folderContent = (
    <TileWrapper
        label={tile.label || ''}
        isLocked={isLocked}
        isEditor={isEditor}
        className={cornerClassName}
        isActive={isActive}
        accent={accent}
        animation={activeAnimation}
    >
        {/* Child-count chip (folders carry no battery, so top-left is free) */}
        {itemCount > 0 && (
            <span className="absolute top-2 left-2 z-20 px-1.5 py-0.5 rounded-full bg-black/30 text-gray-300 text-[0.6rem] font-semibold tabular-nums leading-none pointer-events-none">
                {itemCount}
            </span>
        )}
        {iconToRender}
    </TileWrapper>
  );

  // In editor mode or if locked, it's not a link.
  // In editor, Admin.tsx handles navigation via onDoubleClick.
  // In dashboard view, if locked, it does nothing.
  if (isEditor || isLocked) {
    return folderContent;
  }

  return (
    <Link to={`/dashboard/${panelId}${location.search}`} className="h-full w-full no-underline" aria-label={`Open folder ${device.name}`}>
      {folderContent}
    </Link>
  );
};

export default FolderTile;
