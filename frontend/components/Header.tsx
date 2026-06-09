
import React from 'react';
import { NavLink, Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { IconLayoutGrid, IconSettings, IconChevronDown, IconVolume2, IconVolumeX, IconHome } from './icons';
import { useDashboard } from '../hooks/useDashboard';
import { useAuth } from '../hooks/useAuth';
import { useWeather } from '../hooks/useWeather';
import { DashboardPanel } from '../types';
import ArmingStatusIndicator from './ArmingStatusIndicator';

const Clock = () => {
    const [time, setTime] = React.useState(new Date());

    React.useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    // Ambient cluster: prominent time + a quieter date line, tabular figures so
    // the minutes don't shift the layout each tick.
    return (
        <div className="flex flex-col items-end leading-none">
            <div className="text-2xl font-semibold text-white tabular-nums tracking-tight">
                {time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
            <div className="text-xs font-medium text-gray-400 mt-1">
                {time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
        </div>
    );
};

// Frosted-glass header bar so the ambient canvas reads through the chrome.
// `relative z-40` lifts the header (and its overflowing weather/panel
// dropdowns) above the tile grid — the frosted-glass backdrop-blur creates a
// stacking context, so without an explicit z-index the <main> grid that
// follows in the DOM would paint over the dropdowns.
const HEADER_CLASS = "relative z-40 bg-gray-800 border-b border-white/5 shadow-md";
const HEADER_STYLE: React.CSSProperties = {
    backgroundColor: 'rgb(var(--surface-raised) / 0.8)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
};

const Weather = () => {
    const { weather, loading, error } = useWeather();
    const [isForecastOpen, setForecastOpen] = React.useState(false);
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    
    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setForecastOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [wrapperRef]);
    
    // Show the last-known weather whenever we have it — only fall back to the
    // loading/unavailable states when there is genuinely nothing to display, so
    // a transient refresh error never hides good data.
    if (!weather) {
        if (loading) {
            return <div className="text-sm text-gray-400">Loading weather...</div>;
        }
        return <div className="text-sm text-yellow-400" title={error || 'Weather data unavailable'}>Weather unavailable</div>;
    }

    return (
        <div className="relative" ref={wrapperRef}>
            <button 
                onClick={() => setForecastOpen(prev => !prev)}
                className="flex items-center gap-2 p-1 -m-1 rounded-md hover:bg-gray-700 transition-colors" 
                title={weather.description}
                aria-expanded={isForecastOpen}
            >
                {weather.icon}
                <span className="text-lg font-medium text-white">{weather.temperature}°F</span>
            </button>

            {isForecastOpen && weather.forecast && (
                 <div className="absolute top-full right-0 mt-2 w-64 bg-gray-700 rounded-lg shadow-xl p-3 z-20 border border-gray-600">
                    <ul className="space-y-2">
                        {weather.forecast.map(day => (
                            <li key={day.date} className="flex justify-between items-center text-sm">
                                <span className="font-semibold text-gray-200 w-10">{day.dayOfWeek}</span>
                                <span className="flex-shrink-0">{day.icon}</span>
                                <span className="text-gray-300 w-16 text-right">
                                    <span className="font-medium text-white">{day.highTemp}°</span> / {day.lowTemp}°
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const MuteButton = () => {
    const { ttsNotificationsEnabled, toggleTtsNotifications } = useDashboard();
    
    // Strict boolean conversion to ensure reliable rendering
    const isEnabled = Boolean(ttsNotificationsEnabled);

    const handleMuteToggle = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTtsNotifications();
    };

    // Active = Audio ON (Gray/Normal), Inactive = Muted (Red/Warning)
    // Using more explicit styling to ensure the state is visible.
    const buttonClass = isEnabled 
        ? "text-gray-300 hover:bg-gray-700 hover:text-white" 
        : "text-red-400 bg-red-900/30 ring-1 ring-red-500/50 hover:bg-red-900/50";

    return (
      <button
        onClick={handleMuteToggle}
        className={`p-2 rounded-full transition-all cursor-pointer ${buttonClass}`}
        title={isEnabled ? "Mute Notifications" : "Unmute Notifications"}
        aria-label={isEnabled ? "Mute" : "Unmute"}
      >
        {isEnabled ? <IconVolume2 className="w-5 h-5" /> : <IconVolumeX className="w-5 h-5" />}
      </button>
    );
};

const AREA_LABELS: Record<string, string> = {
  pool: 'Pool',
  climate: 'Heating & Cooling',
  security: 'Security',
  lights: 'Lights',
  generator: 'Generator',
};

const Header = () => {
  const { panels, dashboardTitle } = useDashboard();
  const { user, isAuthenticated, logout } = useAuth();
  const { panelId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const isHeadless = searchParams.get('headless') === 'true';
  const isDashboardView = location.pathname.startsWith('/dashboard');
  const isAdminView = location.pathname.startsWith('/admin');
  const isHomeView = location.pathname === '/home';
  const isAreaView = location.pathname.startsWith('/area/');
  const areaKey = isAreaView ? location.pathname.split('/')[2] : undefined;
  const areaLabel = areaKey ? (AREA_LABELS[areaKey] || areaKey) : undefined;

  const [isDropdownOpen, setDropdownOpen] = React.useState(false);

  const getRootPanel = (startPanelId: string | undefined): DashboardPanel | undefined => {
      if (!startPanelId) return undefined;
      let currentPanel = panels.find(p => p.id === startPanelId);
      if (!currentPanel) return undefined;
      while (currentPanel.parentId) {
          const parent = panels.find(p => p.id === currentPanel.parentId);
          if (!parent) break;
          currentPanel = parent;
      }
      return currentPanel;
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const rootPanel = getRootPanel(panelId);
  const firstTopLevelPanel = panels.find(p => !p.parentId);
  // Always link the title/home button to /home (the HomeOverview landing page).
  const homePath = '/home';
  const homePathWithParams = `${homePath}${location.search}`;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive && location.search === '' // Only active if on main admin page
        ? 'bg-brand-blue text-white'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`;

  if (isHeadless) {
    return (
      <header className={HEADER_CLASS} style={HEADER_STYLE}>
        <nav className="container mx-auto px-4 sm:px-6 md:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <span className="text-xl font-bold text-white">{dashboardTitle}</span>
            </div>
            <div className="flex items-center gap-4">
              <Weather />
              <Clock />
              <MuteButton />
              <ArmingStatusIndicator />
            </div>
          </div>
        </nav>
      </header>
    );
  }
    
  return (
    <header className={HEADER_CLASS} style={HEADER_STYLE}>
      <nav className="container mx-auto px-4 sm:px-6 md:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left Side */}
          <div className="flex items-center gap-4">
            <Link to={homePathWithParams} className="text-xl font-bold text-white hidden sm:block mr-2">{dashboardTitle}</Link>
            {/* Area label: show the current area name when viewing an area or Home */}
            {(isHomeView || isAreaView) && (
              <span className="hidden sm:inline text-sm font-semibold text-gray-300">
                {isAreaView && areaLabel ? areaLabel : 'Home'}
              </span>
            )}
             {(isDashboardView || isAdminView) && (
                <div className="relative">
                    <button
                        onClick={() => setDropdownOpen(!isDropdownOpen)}
                        onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
                        aria-expanded={isDropdownOpen}
                        aria-haspopup="true"
                    >
                        <IconLayoutGrid className="w-5 h-5" />
                        <span className="hidden sm:inline font-semibold">
                          {isDashboardView ? (rootPanel ? rootPanel.name : 'Dashboards') : 'Test Dashboards'}
                        </span>
                        <IconChevronDown className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isDropdownOpen && (
                        <div className="absolute left-0 mt-2 w-56 bg-gray-700 rounded-control shadow-elev-2 border border-white/5 p-1.5 z-10 space-y-0.5" role="menu" aria-orientation="vertical">
                            {/* Home entry first */}
                            <NavLink
                                to="/home"
                                onClick={() => setDropdownOpen(false)}
                                className={({isActive}) => `flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-lg transition-colors ${isActive ? 'bg-brand-blue text-white' : 'text-gray-200 hover:bg-gray-600'}`}
                                role="menuitem"
                            >
                                <IconHome className="w-4 h-4" />
                                Home
                            </NavLink>
                            {/* Existing dashboard panels */}
                            {panels.filter(p => !p.parentId).map(panel => (
                                <NavLink
                                    key={panel.id}
                                    to={`/dashboard/${panel.id}${location.search}`}
                                    onClick={() => setDropdownOpen(false)}
                                    className={({isActive}) => `block px-4 py-3 text-sm font-medium rounded-lg transition-colors ${isActive && rootPanel?.id === panel.id ? 'bg-brand-blue text-white' : 'text-gray-200 hover:bg-gray-600'}`}
                                    role="menuitem"
                                >
                                    {panel.name}
                                </NavLink>
                            ))}
                        </div>
                    )}
                </div>
            )}
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-4">
             {(isDashboardView || isHomeView || isAreaView) && (
                <>
                    <Weather />
                    <Clock />
                    <MuteButton />
                </>
             )}
            <ArmingStatusIndicator />

            <NavLink to="/admin" className={navLinkClass} aria-label="Admin Settings">
                <IconSettings className="w-5 h-5" />
                <span className="hidden sm:inline">Admin</span>
            </NavLink>
            
            {isAuthenticated && user && (
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-300 hidden sm:inline">
                        {user.displayName}
                    </span>
                    <button 
                        onClick={handleLogout} 
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
                    >
                        Logout
                    </button>
                </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;
