
import type { ReactNode } from 'react';

export enum DeviceType {
  Light = 'LIGHT',
  Dimmer = 'DIMMER',
  Switch = 'SWITCH',
  Shade = 'SHADE',
  Scene = 'SCENE',
  TemperatureSensor = 'TEMPERATURE_SENSOR',
  MotionSensor = 'MOTION_SENSOR',
  ContactSensor = 'CONTACT_SENSOR',
  SmartPlug = 'SMART_PLUG',
  Keypad = 'KEYPAD',
  Thermostat = 'THERMOSTAT',
  OccupancySensor = 'OCCUPANCY_SENSOR',
  AlarmPanel = 'ALARM_PANEL',
  WebFrame = 'WEB_FRAME',
  Folder = 'FOLDER',
  Camera = 'CAMERA',
  Siren = 'SIREN',
  CameraGroup = 'CAMERA_GROUP',
  SonosPlayer = 'SONOS_PLAYER',
  PanicButton = 'PANIC_BUTTON',
  Lock = 'LOCK',
  AlarmHistory = 'ALARM_HISTORY',
  RSSFeed = 'RSS_FEED',
  WaterSensor = 'WATER_SENSOR',
  Valve = 'VALVE',
  Virtual = 'VIRTUAL',
  SmokeDetector = 'SMOKE_DETECTOR',
  CarbonMonoxideDetector = 'CARBON_MONOXIDE_DETECTOR',
  Generator = 'GENERATOR',
  LitterRobot = 'LITTER_ROBOT',
  Vacuum = 'VACUUM',
  Pet = 'PET',
  InternetMonitor = 'INTERNET_MONITOR',
  FishingReport = 'FISHING_REPORT',
  HaywardPool = 'HAYWARD_POOL',
  Flair = 'FLAIR',
  CoolMaster = 'COOLMASTER',
  PoolFloor = 'POOL_FLOOR',
  // Fallback type for Home Assistant entities whose domain isn't explicitly
  // mapped to a bespoke type above. The tile and (later) command routing are
  // driven by the inferred `capabilities` rather than a per-type
  // implementation, so entities from new integrations render without
  // per-module code.
  Generic = 'GENERIC',
  // Phase 6 escape hatch: embeds a custom Home Assistant Lovelace / HACS card
  // (or any URL) in a sandboxed iframe. HA-aware — resolves a relative
  // dashboard path against the configured HA connection's base URL.
  HACustomCard = 'HA_CUSTOM_CARD',

  // Surface 1 — Pool / Spa (Pentair IntelliCenter).
  // Self-driven: the tile hooks directly into subscribeEntities and resolves
  // all IntelliCenter entities at runtime. See hooks/usePoolSurface.ts.
  // Bind by OBJTYPE/OBJNAM attributes, NOT by literal entity_id.
  IntelliCenterPool = 'INTELLICENTER_POOL',
}

// A small, stable vocabulary of what an entity can *do*, inferred from Home
// Assistant's own metadata (domain, device_class, supported_features,
// attributes). Tiles and command routing key off these instead of a fixed
// DeviceType, so an unmapped domain still renders and (later) controls.
export type Capability =
  | 'toggle'
  | 'brightness'
  | 'color'
  | 'colorTemp'
  | 'position'
  | 'setpoint'
  | 'mode-select'
  | 'number'
  | 'press'
  | 'media-transport'
  | 'sensor-readonly'
  | 'lock'
  | 'alarm';

export enum DeviceService {
  Lutron = 'Lutron',
  SmartThings = 'SmartThings',
  Virtual = 'Virtual',
  Sonos = 'Sonos',
  Noonlight = 'Noonlight',
  HomeAssistant = 'HomeAssistant',
  RTSP = 'RTSP',
  EnergyTrak = 'EnergyTrak',
  Whisker = 'Whisker',
  Tempest = 'Tempest',
  HaywardPool = 'HaywardPool',
  Flair = 'Flair',
  CoolMaster = 'CoolMaster',
  PoolFloor = 'PoolFloor',
}

export interface ColorTempRange {
  min: number;
  max: number;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  service: DeviceService;
  state: string | number | boolean | Record<string, any>;
  location?: string;
  locationId?: string;
  battery?: number;
  // Online/availability flag (false renders the offline treatment per the tile
  // design conventions in CLAUDE.md). Optional/additive.
  isOnline?: boolean;
  // Lutron-specific capability properties
  controlType?: string;
  supportsColor?: boolean;
  supportsColorTemp?: boolean;
  colorTempRange?: ColorTempRange;
  // Capability metadata inferred from the source integration (currently Home
  // Assistant). Optional and additive: existing devices/configs and the iOS
  // model are unaffected. Drives the generic tile and (later) command routing.
  capabilities?: Capability[];
  capabilityData?: Record<string, any>;
}

export interface TileDisplayOverride {
    onLabel?: string;
    offLabel?: string;
    onIcon?: string;
    offIcon?: string;
    invertState?: boolean;
}

export interface TileAnimationConfig {
    enabled?: boolean;
    effect?: 'pulse' | 'bounce';
    color?: string;
}

export interface TileConfig {
  id: string;
  deviceId: string;
  label?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  requirePin?: boolean;
  isLocked?: boolean;
  cameraEnlargeOnClick?: boolean;
  displayOverride?: TileDisplayOverride;
  folderIcon?: string;
  animation?: TileAnimationConfig;
}

export interface HighlightSectionConfig {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundStyle?: 'default' | 'glow';
  glowColor?: string;
}

export type ThemeMode = 'dark' | 'light' | 'auto';

export type IdleMode = 'always-on' | 'screen-off' | 'screen-saver';

/// Schedule windows applied by the iOS kiosk shell (BPanels.app).
/// Times are "HH:MM" strings in the iPad's local time. Wraparound is
/// supported (start > end means the window crosses midnight).
/// `days` is 0..6 (Sun=0..Sat=6). Omit or leave empty for "every day".
/// The browser dashboards ignore these fields — only the native iOS
/// shell reads them.

export interface PanelDimWindow {
  start: string;        // "HH:MM"
  end: string;          // "HH:MM"
  brightness: number;   // 0.0 – 1.0
  days?: number[];      // 0..6 (Sun..Sat); omit/empty = every day
}

export interface PanelMuteWindow {
  start: string;
  end: string;
  days?: number[];
}

export interface PanelIdleConfig {
  mode: IdleMode;
  idleTimeoutSeconds?: number;
  screenSaverText?: string;
  screenSaverBackgroundColor?: string;
  screenSaverBackgroundImageUrl?: string;
  screenSaverShowClock?: boolean;
  /// iOS-only — wall-mounted iPad kiosks dim the screen on a
  /// time-of-day + day-of-week schedule. First matching window wins.
  dimSchedule?: PanelDimWindow[];
  /// iOS-only — when the iPad's local time falls inside one of these
  /// windows, TTS / alarm-siren / sound-effect playback is suppressed.
  /// Useful for "no panic siren between 11pm and 6am, weekends only"
  /// style rules.
  muteSchedule?: PanelMuteWindow[];
  /// iOS-only — while idle, use the iPad's front camera to detect
  /// movement and wake the screen (like a touch). Off by default;
  /// requires camera permission and uses some battery.
  motionWakeEnabled?: boolean;
}

export interface DashboardPanel {
  id:string;
  name: string;
  tiles: TileConfig[];
  highlights?: HighlightSectionConfig[];
  parentId?: string;
  columns?: number;
  rowHeight?: number;
  showAlarmAlerts?: boolean;
  showArmingStatus?: boolean;
  themeMode?: ThemeMode;
  showTileBorders?: boolean;
  idleConfig?: PanelIdleConfig;
}

export interface ServiceConnection {
    id: DeviceService;
    cloudEndpoint: string;
    localEndpoint?: string;
    apiKey?: string;
    preferLocal?: boolean;
    enabled: boolean;
    selectedLocations?: string[];
    webSocketUrl?: string;
    // Noonlight Specific
    apiToken?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    name?: string;
    phone?: string;
    // Lutron Specific
    lutronClientKey?: string;
    lutronClientCert?: string;
    lutronCaCert?: string;
    lutronManualIp?: string;
    // EnergyTrak Specific
    energytrakEmail?: string;
    energytrakMagicLink?: string;
    // Whisker Specific
    whiskerEmail?: string;
    whiskerPassword?: string;
    // Tempest Specific
    tempestApiToken?: string;
    tempestStationId?: string;
    // Hayward Pool Specific
    haywardEmail?: string;
    haywardPassword?: string;
    haywardControllerIp?: string; // Local controller IP (e.g., 192.168.1.100)
    haywardConnectionMode?: 'local' | 'cloud' | 'both' | 'demo'; // 'both' = local-first, cloud fallback
    // Flair Specific (OAuth2 client credentials from Flair developer API)
    flairClientId?: string;
    flairClientSecret?: string;
    flairConnectionMode?: 'cloud' | 'demo';
    // CoolAutomation / CoolMaster Specific — dual-transport (local box + cloud)
    coolmasterConnectionMode?: 'local' | 'cloud' | 'both' | 'demo';
    coolmasterLocalIp?: string;           // IP of the CoolMasterNet gateway on the LAN
    coolmasterLocalDeviceId?: string;     // gateway serial e.g. "L4.123"; auto-discovered on first configure
    coolmasterUsername?: string;          // CoolAutomation cloud account email
    coolmasterPassword?: string;
    coolmasterUnitAliases?: Record<string, string>; // "L1.100" → "Primary Bedroom"
    // Pool Floor (Akvo Spiralift) Specific — Modbus TCP
    poolFloorConnectionMode?: 'live' | 'demo';
    poolFloorIp?: string;
    poolFloorPort?: number;
    poolFloorUnitId?: number;
    poolFloorConfigNames?: string[]; // labels for configs 1-8, e.g. ["Diving", "Lap Swim", ...]
    // Home Assistant Specific
    haAlarmEntityId?: string;        // e.g. alarm_control_panel.alarmo
    haAlarmCode?: string;            // optional disarm PIN
    locationAliases?: Record<string, string>; // locationId → display name
}

export interface User {
    id: string;
    name: string;
    pin: string;
}

// Represents a user account that can log into the admin panel.
export interface AdminUser {
    id: string;
    username: string;
    displayName: string;
}

export interface MediaItem {
    id: string;
    name: string;
    type: 'url' | 'tts';
    triggerPath: string; // e.g., 'dog' or 'front-door-open'
    url?: string; // For type 'url'
    text?: string; // For type 'tts'
    voiceURI?: string; // For type 'tts'
    assignedPanels: string[]; // Panel IDs, or ['*'] for all
}

export type SonosNotificationEventType = 'motion-active' | 'contact-open' | 'contact-close' | 'leak-detected' | 'smoke-detected' | 'carbon-monoxide-detected' | 'siren-on' | 'intrusion-detected';

export interface SonosNotification {
    id: string;
    eventType: SonosNotificationEventType;
    targetDeviceIds: string[]; // Sonos player device IDs
    message: string; // The message to speak, with placeholders like {deviceName}
    volume?: number;
}

export interface AllowedIP {
    id: string;
    name: string;
    ip: string;
}

export interface AlarmState {
    locationId: string;
    locationName: string;
    armState: 'disarmed' | 'armedStay' | 'armedAway';
    securityState: 'OK' | 'VIOLATION' | null;
    violatingSensors: { name: string }[];
    trigger?: { name: string; type: string } | null;
    beforeArmState?: string | null;
    // HA-specific fields (populated when source === 'ha')
    source?: 'st' | 'ha';
    haOpenSensors?: Record<string, string> | null;       // entity_id → state from Alarmo open_sensors
    haAvailableModes?: string[];                          // from alarmo_ready_to_arm_modes_updated
    haArmError?: { reason: string; sensors: string[] } | null;  // from alarmo_failed_to_arm
    haExitDelay?: number | null;                          // remaining exit-delay seconds during 'arming' state
    haEntryDelay?: number | null;                         // remaining entry-delay seconds during 'pending' state
    // Raw alarm phase straight from the alarm_control_panel state machine. Drives
    // the exit/entry/trigger UI. 'arming' = exit delay, 'pending' = entry delay,
    // 'triggered' = siren. Everything else is steady-state (idle/armed).
    phase?: 'idle' | 'arming' | 'pending' | 'triggered';
    // Absolute-time countdown anchor for the current delay phase. The UI computes
    // remaining = (delayStartedAt + delayTotal) - now each tick, so it stays
    // correct across reconnects, tab-throttling, and every panel (vs a local
    // decrementing timer that drifts). delayTotal is Alarmo's `delay` attribute
    // (total seconds); delayStartedAt is the entity's last_changed (ISO).
    haDelayTotal?: number | null;
    haDelayStartedAt?: string | null;
}

export interface AppNotification {
    id: number;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
}

export interface ArmingEvent {
    timestamp: string; // ISO 8601 format
    /// `armState` transitions record the arm/disarm/stay status.
    /// `'triggered'` records an intrusion-detected event; armState
    /// itself stays the same on intrusion (the alarm is still armed,
    /// just now in violation), so we need a distinct status value
    /// to render it in the history tile.
    status: AlarmState['armState'] | 'triggered';
    /// For `status === 'triggered'`, the device/sensor that fired
    /// the alarm (e.g. "Front Door"). Undefined for arm/disarm events.
    triggerName?: string;
}

export interface SonosTrack {
  artist?: string;
  title?: string;
  album?: string;
  albumArtURI?: string;
  duration?: number; // in seconds
}

export type SonosPlayMode = 'NORMAL' | 'REPEAT_ALL' | 'SHUFFLE_NO_REPEAT' | 'SHUFFLE' | 'SHUFFLE_REPEAT_ONE';

export interface SonosPlayerState {
  playbackState: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING';
  volume: number;
  currentTrack: SonosTrack;
  roomName: string;
  elapsedTime?: number; // in seconds
  playMode?: {
    repeat: boolean;
    shuffle: boolean;
    crossfade: boolean;
  };
}

export type LitterRobotStatus =
  | 'READY'
  | 'CYCLING'
  | 'DRAWER_FULL'
  | 'CAT_DETECTED'
  | 'EMPTYING'
  | 'PAUSED'
  | 'BONNET_REMOVED'
  | 'OFFLINE'
  | 'FAULT';

export interface LitterRobotState {
  // Identification
  id: string;
  serial: string;
  name: string;
  model: string;
  firmware?: string;

  // Status
  isOnline: boolean;
  powerStatus: string;
  unitStatus: string;
  statusCode?: string;
  statusText: string;
  normalizedStatus: LitterRobotStatus;

  // Cycle info
  cycleCount: number;
  cyclesAfterDrawerFull: number;

  // Waste drawer
  isDFITriggered: boolean;
  DFILevelPercent?: number;
  wasteLevel: number; // 0-100 percentage

  // Settings
  cleanCycleWaitTime?: number;
  isNightLightModeEnabled?: boolean;
  isPanelLockEnabled?: boolean;

  // Sleep mode
  sleepModeEnabled: boolean;
  sleepModeStartTime?: string;
  sleepModeEndTime?: string;

  // Timestamps
  lastSeen?: string;
  setupDate?: string;

  // LR4-specific
  isLR4: boolean;
  litterLevel?: number;
  petWeight?: number;
  catWeight?: number;
  isCatDetected?: boolean;
  catDetectionCount?: number;
  brightnessLevel?: number;
  weightSensor?: number;

  // LR3-specific
  isLR3: boolean;
  didNotifyOffline?: boolean;
  // HA-only: entity_ids backing the modal's quick-action commands.
  haEntities?: { vacuum?: string; nightLight?: string; panelLock?: string; reset?: string };
}

export interface ForecastDay {
    date: string;
    dayOfWeek: string;
    // Fix: Use ReactNode type
    icon: ReactNode;
    highTemp: number;
    lowTemp: number;
}

export interface WeatherData {
  temperature: number;
  feelsLike?: number;
  humidity?: number;
  description: string;
  // Fix: Use ReactNode type
  icon: ReactNode;
  forecast: ForecastDay[];
  sunrise?: string; // ISO String
  sunset?: string; // ISO String
  // Resolved day/night flag, preferred for `auto` theme. Sourced from HA's
  // `sun.sun` entity when available (the HA weather/Tempest path carries no
  // sunrise/sunset), else derived from sunrise/sunset in the Open-Meteo path.
  isDaytime?: boolean;
  // Tempest-specific extended data
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  pressure?: number;
  uvIndex?: number;
  solarRadiation?: number;
  precipitationRate?: number;
  precipitationToday?: number;
  lightningStrikeCount?: number;
  lightningLastDistance?: number;
  stationName?: string;
  lastUpdated?: string;
}

export type CheckType = 'http' | 'https' | 'ping' | 'dns';

export interface CheckEndpoint {
  type: CheckType;
  target: string; // URL for http/https, hostname/IP for ping/dns
  description?: string; // Optional display name
}

export interface InternetMonitorConfig {
  enabled: boolean;
  checkIntervalSeconds: number; // How often to check internet connectivity
  failureThreshold: number; // Number of consecutive failures before triggering reboot
  rebootCooldownMinutes: number; // Minimum time between reboots
  postRebootWaitMinutes: number; // How long to wait after reboot before resuming checks

  // Smart plug configuration
  smartPlugIp: string;
  smartPlugEmail?: string;
  smartPlugPassword?: string;

  // Upstream check endpoints - array of different check types
  checkEndpoints: CheckEndpoint[];
  endpointTimeout: number; // Timeout in seconds for each endpoint check

  // Notification settings
  notifyOnFailure: boolean;
  notifyOnReboot: boolean;
  notifyOnRecovery: boolean;
}

export interface CheckResult {
  type: CheckType;
  endpoint: string;
  success: boolean;
  responseTime?: number;
  error?: string;
  details?: string; // Additional info like HTTP status code, DNS records, etc.
}

export interface InternetMonitorStatus {
  isOnline: boolean;
  lastCheckTime: string; // ISO 8601
  consecutiveFailures: number;
  lastRebootTime?: string; // ISO 8601
  nextRebootAllowedTime?: string; // ISO 8601
  currentStatus: 'online' | 'offline' | 'checking' | 'waiting_after_reboot' | 'cooldown';
  statusMessage: string;
  checkResults?: CheckResult[];
  checkSummary?: {
    total: number;
    passed: number;
    failed: number;
    byType: Record<CheckType, { passed: number; failed: number }>;
  };
}

export interface FishingReportConfig {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  stationId: string | null; // NOAA station ID for tide data
  timezone: string;
}

// Hayward Pool Types

export interface HaywardPoolBody {
  id: string;
  name: string;
  type: 'pool' | 'spa';
  waterTemp: number | null;
  targetTemp: number | null;
  heaterState: 'off' | 'heating' | 'cooling' | 'idle';
  filterSpeed: number; // 0 = off, 1-8 for variable speed, 100 = on (single speed)
  filterMinSpeed?: number;
  filterMaxSpeed?: number;
}

export interface HaywardPoolPump {
  id: string;
  name: string;
  isOn: boolean;
  speed: number; // RPM or 0-100%
  minSpeed?: number;
  maxSpeed?: number;
}

export interface HaywardPoolChlorinator {
  id: string;
  name: string;
  isOn: boolean;
  outputPercent: number; // 0-100
  saltLevel: number; // PPM
  status: string;
  superChlor: boolean;
}

export interface HaywardPoolLight {
  id: string;
  name: string;
  isOn: boolean;
  color?: string;
  brightness?: number;
}

export interface HaywardPoolState {
  // System info
  systemId: string;
  systemName: string;
  firmwareVersion?: string;
  isOnline: boolean;
  connectionMode: 'local' | 'cloud' | 'both' | 'demo';
  activeTransport: 'local' | 'cloud' | 'demo' | null;
  lastUpdated: string; // ISO 8601

  // Environment
  airTemp: number | null;

  // Bodies of water (pool and/or spa)
  bodies: HaywardPoolBody[];

  // Equipment
  pumps: HaywardPoolPump[];
  chlorinator: HaywardPoolChlorinator | null;
  lights: HaywardPoolLight[];

  // Chemistry
  ph: number | null;
  orp: number | null; // Oxidation Reduction Potential (mV)
  saltLevel: number | null; // PPM

  // Misc
  valves: { id: string; name: string; isOpen: boolean }[];
  auxRelays: { id: string; name: string; isOn: boolean }[];
}

// Flair HVAC Vent Types

export type FlairSystemMode = 'heat' | 'cool' | 'auto' | 'off';
export type FlairHvacState = 'heating' | 'cooling' | 'idle' | 'off';
export type FlairRoomMode = 'active' | 'inactive'; // Flair "Active Rooms" concept

export interface FlairVent {
  id: string;
  name: string;
  roomId: string | null;
  percentOpen: number;       // 0-100, current position
  targetPercentOpen: number; // 0-100, commanded position
  isInverted: boolean;
  hasBuck: boolean;          // has local temp sensor
  ductTemp: number | null;   // °F measured in duct
  ductPressure: number | null;
  rssi: number | null;
  voltage: number | null;
  isActive: boolean;
  isOnline: boolean;
  firmware?: string | null;
  lastReading?: string | null;
}

export interface FlairRoom {
  id: string;
  name: string;
  structureId: string;

  // Current conditions
  currentTemp: number | null;    // °F
  currentHumidity: number | null;

  // Setpoint / control
  setPointTemp: number | null;   // °F — what the room is targeting
  setPointManual: boolean;       // user manual override vs schedule
  activeMode: FlairRoomMode;     // whether Flair is actively managing this room
  hvacState: FlairHvacState;     // current heating/cooling demand

  // Flair puck (in-room sensor)
  hasPuck: boolean;
  puckTemp: number | null;
  puckHumidity: number | null;

  // Vents in this room
  vents: FlairVent[];

  // Metadata
  levelName?: string | null;     // floor/zone
  isOnline: boolean;
  lastUpdated: string | null;
}

export interface FlairStructure {
  id: string;
  name: string;
  systemMode: FlairSystemMode;           // heat/cool/auto/off at system level
  setPointDisplay: 'F' | 'C';
  homeAwayMode: 'home' | 'away' | 'auto';
  isOnline: boolean;

  // Outside conditions (from Flair)
  outsideTemp: number | null;
  outsideHumidity: number | null;

  // Aggregates
  roomCount: number;
  ventCount: number;
  activeRoomCount: number;
}

export interface FlairState {
  // Identification
  structureId: string;
  structureName: string;
  isOnline: boolean;
  connectionMode: 'cloud' | 'demo';
  lastUpdated: string; // ISO 8601

  // Structure-level
  structure: FlairStructure;

  // Rooms with their vents nested
  rooms: FlairRoom[];
}

// CoolAutomation / CoolMaster HVAC Types (Mitsubishi VRF via CoolMasterNet gateway)

export type CoolMasterMode  = 'cool' | 'heat' | 'auto' | 'fan' | 'dry';
export type CoolMasterFan   = 'vlow' | 'low' | 'med' | 'high' | 'top' | 'auto';
export type CoolMasterSwing = 'auto' | 'horizontal' | 'vertical' | '30' | '60' | 'stop';

export interface CoolMasterUnitCapabilities {
  modes: CoolMasterMode[];
  fanSpeeds: CoolMasterFan[];
  swings: CoolMasterSwing[];
  minSetF: number;
  maxSetF: number;
}

export interface CoolMasterUnit {
  id: string;                        // "L1.100" (local UID) or cloud unit id
  name: string;                      // resolved via coolmasterUnitAliases, else raw UID
  lineId: string;                    // "L1"
  isOn: boolean;
  mode: CoolMasterMode;
  fanSpeed: CoolMasterFan;
  swing: CoolMasterSwing;
  roomTemp: number | null;           // °F
  setPoint: number | null;           // °F
  tempScale: 'F' | 'C';
  errorCode: string | null;          // null for OK; otherwise the raw Mitsubishi code
  errorDescription: string | null;   // human-readable text via coolmaster/error-codes.js; null when errorCode is null
  filterDirty: boolean;
  demandActive: boolean;             // `#` in ls2 = compressor/demand flag
  isOnline: boolean;
  capabilities?: CoolMasterUnitCapabilities;
}

export interface CoolMasterLine {
  id: string;                        // "L1"
  brand: string;                     // e.g. "Mitsubishi Electric VRF"
  unitCount: number;
  activeUnitCount: number;
  compressorOn: boolean;
  outdoorTemp: number | null;
}

export interface CoolMasterSystem {
  deviceId: string;                  // gateway serial
  name: string;
  model: 'CoolMasterNet' | 'CoolMasterPro' | 'CoolLinkHub' | 'Unknown';
  firmware: string | null;
  tempScale: 'F' | 'C';
  lineCount: number;
  unitCount: number;
  activeUnitCount: number;
}

export interface CoolMasterState {
  systemId: string;
  systemName: string;
  isOnline: boolean;
  connectionMode: 'local' | 'cloud' | 'both' | 'demo';
  activeTransport: 'local' | 'cloud' | 'demo' | null;
  lastUpdated: string;               // ISO 8601
  system: CoolMasterSystem;
  lines: CoolMasterLine[];
  units: CoolMasterUnit[];
}

// ── Akvo Spiralift Movable Pool Floor ────────────────────────────────────────
export interface PoolFloorState {
  isOnline:              boolean;
  lastUpdated:           string | null;
  commOk:                boolean;

  // HR 0 — Status Word 1
  systemReady:           boolean;
  inFault:               boolean;
  controlKeyOn:          boolean;
  estopIndoor:           boolean;
  estopOutdoor:          boolean;
  powerDisabled:         boolean;
  operatorLoggedIn:      boolean;
  adminLoggedIn:         boolean;
  techLoggedIn:          boolean;
  watchdogFromAkvo:      boolean;
  badModbusComm:         boolean;
  readyForExtCommands:   boolean;

  // HR 1 — Status Word 2
  floorsMoving:          boolean;
  notInPredefined:       boolean;
  configsAchieved:       number;   // bitmask: bit 0 = config 1 achieved … bit 7 = config 8

  // Fault bitmasks (HR 2, 3, 4)
  mainFloorFaults:       number;
  bajaFaults:            number;
  topPlateFaults:        number;

  // HR 6/7 — Depths in mm (negative = above deck)
  mainFloorDepthMm:      number | null;
  bajaDepthMm:           number | null;

  // HR 8/9 — Motor current in Amps
  mainFloorCurrentA:     number | null;
  bajaCurrentA:          number | null;

  // Currently active command bit (0=reset, 1-8=config, null=none)
  activeCommandBit:      number | null;
}
