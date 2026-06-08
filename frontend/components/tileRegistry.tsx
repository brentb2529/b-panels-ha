import React from 'react';
import { Device, DeviceType, TileConfig } from '../types';

import DimmerTile from './tiles/DimmerTile';
import ShadeTile from './tiles/ShadeTile';
import SwitchTile from './tiles/SwitchTile';
import SceneTile from './tiles/SceneTile';
import SensorTile from './tiles/SensorTile';
import ThermostatTile from './tiles/ThermostatTile';
import AlarmTile from './tiles/AlarmTile';
import WebFrameTile from './tiles/WebFrameTile';
import HACustomCardTile from './tiles/HACustomCardTile';
import FolderTile from './tiles/FolderTile';
import CameraTile from './tiles/CameraTile';
import UnknownTile from './tiles/UnknownTile';
import CameraGroupTile from './tiles/CameraGroupTile';
import GenericCapabilityTile from './tiles/GenericCapabilityTile';
import VacuumTile from './tiles/VacuumTile';
import LitterRobotTile from './tiles/LitterRobotTile';
import SonosPlayerTile from './tiles/SonosPlayerTile';
import PetTile from './tiles/PetTile';
import FlairTile from './tiles/FlairTile';
import RSSFeedTile from './tiles/RSSFeedTile';
import GeneratorTile from './tiles/GeneratorTile';
import PanicTile from './tiles/PanicTile';
import AlarmHistoryTile from './tiles/AlarmHistoryTile';
import LutronSurface from './tiles/LutronSurface';

// Shared prop contract every tile understands. `device` is guaranteed here
// because Tile.tsx resolves only after the not-found guard; individual tiles
// may ignore props they don't use (e.g. most ignore `onEnlarge`).
export interface TileProps {
  tile: TileConfig;
  device: Device;
  onEnlarge?: (device: Device) => void;
  isEditor?: boolean;
  cornerClassName?: string;
}

export type TileComponent = React.ComponentType<TileProps>;

// DeviceType → tile component. This is a 1:1 mirror of the former switch
// statement in Tile.tsx: to add a bespoke tile, register it here once — no
// switch case, no extra import in Tile.tsx. Several device types intentionally
// share a tile (e.g. all the simple on/off types use SwitchTile).
export const tileByType: Partial<Record<DeviceType, TileComponent>> = {
  [DeviceType.Light]: SwitchTile,
  [DeviceType.Switch]: SwitchTile,
  [DeviceType.SmartPlug]: SwitchTile,
  [DeviceType.Siren]: SwitchTile,
  [DeviceType.Lock]: SwitchTile,
  [DeviceType.Valve]: SwitchTile,

  [DeviceType.Dimmer]: DimmerTile,
  [DeviceType.Shade]: ShadeTile,
  [DeviceType.Scene]: SceneTile,

  [DeviceType.TemperatureSensor]: SensorTile,
  [DeviceType.MotionSensor]: SensorTile,
  [DeviceType.ContactSensor]: SensorTile,
  [DeviceType.OccupancySensor]: SensorTile,
  [DeviceType.WaterSensor]: SensorTile,
  [DeviceType.SmokeDetector]: SensorTile,
  [DeviceType.CarbonMonoxideDetector]: SensorTile,

  [DeviceType.Thermostat]: ThermostatTile,
  [DeviceType.AlarmPanel]: AlarmTile,
  [DeviceType.WebFrame]: WebFrameTile,
  [DeviceType.HACustomCard]: HACustomCardTile,
  [DeviceType.Camera]: CameraTile,
  [DeviceType.CameraGroup]: CameraGroupTile,
  [DeviceType.Vacuum]: VacuumTile,
  [DeviceType.LitterRobot]: LitterRobotTile,
  [DeviceType.SonosPlayer]: SonosPlayerTile,
  [DeviceType.Pet]: PetTile,
  [DeviceType.Flair]: FlairTile,
  [DeviceType.RSSFeed]: RSSFeedTile,
  [DeviceType.Generator]: GeneratorTile,
  [DeviceType.PanicButton]: PanicTile,
  [DeviceType.AlarmHistory]: AlarmHistoryTile,
  [DeviceType.Folder]: FolderTile,

  // Lutron HomeWorks QSX: self-driven surface rendering lights/covers/scenes/keypads.
  // Placed as a virtual tile in the dashboard config; discovers entities dynamically.
  [DeviceType.LutronSurface]: LutronSurface,

  // Capability-driven fallback for HA entities whose domain isn't mapped to a
  // bespoke tile above; presentation is derived from the entity's inferred
  // capabilities rather than its DeviceType.
  [DeviceType.Generic]: GenericCapabilityTile,
};

// Resolve the component for a device:
//  1. an explicitly-registered tile for the DeviceType, else
//  2. the capability-driven generic tile when the device carries inferred
//     capabilities (so entities from new integrations render sensibly), else
//  3. UnknownTile as the true last resort.
export function resolveTile(device: Device): TileComponent {
  const byType = tileByType[device.type];
  if (byType) return byType;
  if (device.capabilities && device.capabilities.length > 0) return GenericCapabilityTile;
  return UnknownTile;
}
