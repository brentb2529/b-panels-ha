import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { DashboardProvider, useDashboard } from './hooks/useDashboard';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useWeather } from './hooks/useWeather';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
// Admin is the heavy settings UI and never renders on the kiosk dashboard path.
// Lazy-load it so the first-paint bundle the iPad downloads stays small.
const Admin = React.lazy(() => import('./components/Admin'));
import AudioUnlockModal from './components/AudioUnlockModal';
import AccessDenied from './components/AccessDenied';
import NotificationHost from './components/NotificationHost';
import VersionFooter from './components/VersionFooter';
import LoginPage from './components/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import { apiValidateDeviceToken, bootstrapDeviceToken } from './services/api';
import { IconRefreshCw } from './components/icons';
import { playTextToSpeech, playAudioUrl } from './services/audioPlayer';
import LifeSafetyTakeover from './design-system/takeover/LifeSafetyTakeover';
import { setTakeoverActive } from './design-system/takeover/takeoverSignal';

const DEVICE_AUTH_TOKEN_KEY = 'homeTileDeviceAuthToken';

const GlobalSoundPlayer = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const triggerPath = searchParams.get('playTrigger');
    const { mediaItems, isAudioUnlocked, activePanelId } = useDashboard();

    useEffect(() => {
        if (triggerPath && isAudioUnlocked) {
            const media = mediaItems.find(m => m.triggerPath === triggerPath);
            let shouldClear = false;

            if (media) {
                const isGlobal = media.assignedPanels?.includes('*');
                
                if (isGlobal) {
                    // Global sounds play immediately
                    playSound(media);
                    shouldClear = true;
                } else if (activePanelId) {
                    // Panel-specific sounds wait for activePanelId to be resolved
                    if (media.assignedPanels?.includes(activePanelId)) {
                         playSound(media);
                    } else {
                         console.log(`Trigger "${triggerPath}" skipped for panel ${activePanelId}`);
                    }
                    shouldClear = true;
                }
                // If local sound but activePanelId is not yet set (loading), do NOT clear. 
                // Wait for next render when activePanelId is available.
            } else {
                console.warn(`Media with triggerPath "${triggerPath}" not found.`);
                shouldClear = true;
            }

            if (shouldClear) {
                setSearchParams(prev => {
                    const newParams = new URLSearchParams(prev);
                    newParams.delete('playTrigger');
                    return newParams;
                }, { replace: true });
            }
        }
    }, [triggerPath, mediaItems, isAudioUnlocked, activePanelId, setSearchParams]);

    const playSound = (media: any) => {
         if (media.type === 'tts' && media.text) {
            playTextToSpeech(media.text, media.voiceURI);
        } else if (media.type === 'url' && media.url) {
            playAudioUrl(media.url);
        }
    }

    return null;
};

const PlaySoundAndRedirect = () => {
    const { triggerPath } = useParams<{triggerPath: string}>();
    const { panels } = useDashboard();
    const navigate = useNavigate();

    useEffect(() => {
        // We perform the redirect inside a useEffect with a small timeout.
        // This ensures the component fully mounts and renders its "Processing" state
        // before navigating. This prevents black-screen issues in WebViews (like Fully Kiosk)
        // that can occur with immediate render-time redirects or when swapping heavy components too fast.
        const timer = setTimeout(() => {
            if (panels.length > 0) {
                const firstPanelId = panels[0].id;
                navigate(`/dashboard/${firstPanelId}?playTrigger=${triggerPath}`, { replace: true });
            } else {
                 // Fallback if no panels exist, or just root to trigger defaults
                 navigate(`/?playTrigger=${triggerPath}`, { replace: true });
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [panels, triggerPath, navigate]);

    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <IconRefreshCw className="w-8 h-8 animate-spin mb-4" />
            <p className="text-lg font-medium">Processing Alert...</p>
            <p className="text-sm opacity-70 mt-1">Trigger: {triggerPath}</p>
        </div>
    );
};


const AppRoutes = () => {
  const { panels, loading } = useDashboard();
  
  if (loading) {
      // Render a visible loading state instead of null to prevent black screens
      return (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <IconRefreshCw className="w-10 h-10 animate-spin mb-4" />
              <p className="text-lg">Loading Dashboard...</p>
          </div>
      );
  }
  
  const firstPanelId = panels.length > 0 ? panels[0].id : null;

  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <IconRefreshCw className="w-10 h-10 animate-spin mb-4" />
        <p className="text-lg">Loading…</p>
      </div>
    }>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        } 
      />
      <Route path="/dashboard/:panelId" element={<Dashboard />} />
      <Route path="/play/:triggerPath" element={<PlaySoundAndRedirect />} />
      <Route 
        path="/" 
        element={firstPanelId ? <Navigate to={`/dashboard/${firstPanelId}`} replace /> : (
            <ProtectedRoute>
                <Admin />
            </ProtectedRoute>
        )}
      />
    </Routes>
    </Suspense>
  );
};

const ThemeManager = ({ activePanelId }: { activePanelId: string | null }) => {
    const { panels } = useDashboard();
    const { weather } = useWeather(); // Fetch weather here for sunset/sunrise times
    
    const activePanel = useMemo(() =>
        panels.find(p => p.id === activePanelId),
    [panels, activePanelId]);

    // Theme is inherited from the top-level dashboard: a sub-panel/folder follows
    // its root panel's themeMode, so a dashboard tree shares one look and you set
    // the theme once on the top-level panel. Walk up parentId to the root.
    const themePanel = useMemo(() => {
        let p = activePanel;
        const seen = new Set<string>();
        while (p?.parentId && !seen.has(p.id)) {
            seen.add(p.id);
            const parent = panels.find(x => x.id === p!.parentId);
            if (!parent) break;
            p = parent;
        }
        return p;
    }, [activePanel, panels]);

    // 'light' | 'dark' | 'night'. Explicit dark stays cool-slate dark; auto
    // mode resolves to light during the day and a dimmed, warm 'ambient-night'
    // after dark (less blue light on a wall panel at night).
    const themeClass = useMemo<'light' | 'dark' | 'night'>(() => {
        if (!themePanel) return 'dark';

        const mode = themePanel.themeMode || 'dark';

        if (mode === 'light') return 'light';
        if (mode === 'dark') return 'dark';

        // Auto Mode. Prefer the explicit day/night flag (sourced from HA's
        // sun.sun entity) — the HA/Tempest weather path carries no
        // sunrise/sunset, so without this auto always fell through to dark.
        if (mode === 'auto') {
            if (typeof weather?.isDaytime === 'boolean') {
                return weather.isDaytime ? 'light' : 'night';
            }
            if (weather?.sunrise && weather?.sunset) {
                const now = new Date();
                const sunrise = new Date(weather.sunrise);
                const sunset = new Date(weather.sunset);
                // Day (light) between sunrise and sunset; otherwise ambient night.
                return now >= sunrise && now < sunset ? 'light' : 'night';
            }
        }

        return 'dark'; // Default to dark if auto fails or no weather
    }, [themePanel, weather]);

    const showTileBorders = activePanel?.showTileBorders ?? true;

    useEffect(() => {
        document.body.classList.toggle('light-mode', themeClass === 'light');
        document.body.classList.toggle('ambient-night', themeClass === 'night');
    }, [themeClass]);

    useEffect(() => {
        if (showTileBorders) {
            document.body.classList.add('tile-borders');
        } else {
            document.body.classList.remove('tile-borders');
        }
    }, [showTileBorders]);

    // Neutral surfaces, brand and accents are driven by CSS variables defined
    // in index.html (:root / .light-mode / .ambient-night), so the background
    // colors no longer need per-class overrides here. The rules below cover the
    // cases the variable swap can't: gray-600/700 do double duty as *border*,
    // *hover* and *text* colors (which must stay light in light mode even though
    // their surface is now white) plus stock Tailwind status colors that aren't
    // tokenized.
    return (
        <style>{`
            /* Borders: gray-700/600 map to opaque surfaces; force light separators */
            .light-mode .border-gray-600 { border-color: #d1d5db; /* gray-300 */ }
            .light-mode .border-gray-700 { border-color: #e5e7eb; /* gray-200 */ }
            /* Header / sections keep a hairline bottom rule in light mode */
            .light-mode .bg-gray-800 { border-bottom: 1px solid #e5e7eb; }
            /* Readable text on light control surfaces (gray-600 buttons) */
            .light-mode .bg-gray-600 { color: #374151; /* gray-700 */ }

            /* Hovers: surfaces are white/near-white in light, so give visible feedback */
            .light-mode .hover\\:bg-gray-800:hover { background-color: #f9fafb !important; }
            .light-mode .hover\\:bg-gray-700:hover { background-color: #f9fafb; }
            .light-mode .hover\\:bg-gray-600:hover { background-color: #d1d5db; }
            .light-mode .hover\\:bg-gray-500:hover { background-color: #d1d5db; }

            /* Text Colors (stock Tailwind grays, not tokenized) */
            .light-mode .text-white { color: #111827; }
            .light-mode .text-gray-100 { color: #1f2937; }
            .light-mode .text-gray-200 { color: #374151; }
            .light-mode .text-gray-300 { color: #4b5563; }
            .light-mode .text-gray-400 { color: #6b7280; }

            /* Shadows for depth on light backgrounds */
            .light-mode .shadow-lg {
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            }
            
            /* --- HIGH CONTRAST STATUS INDICATORS --- */
            /* Green: Ready/Disarmed */
            .light-mode .bg-green-500\\/20 { background-color: #dcfce7 !important; }
            .light-mode .text-green-300 { color: #166534 !important; }
            /* Yellow/Orange: Not Ready/Armed Stay */
            .light-mode .bg-orange-500\\/20 { background-color: #fef3c7 !important; }
            .light-mode .text-orange-300 { color: #92400e !important; }
            /* Red: Armed Away */
            .light-mode .bg-red-500\\/20 { background-color: #fee2e2 !important; }
            .light-mode .text-red-300 { color: #991b1b !important; }
            /* Red: Intrusion (already good, but let's be explicit) */
            .light-mode .bg-red-600 { background-color: #dc2626 !important; color: #ffffff !important; }

            /* --- TILE BORDERS --- */
            /* Dark mode: white/light border for contrast */
            .tile-borders .bg-gray-700 {
                border: 2px solid rgba(255, 255, 255, 0.5) !important;
            }
            /* Light mode: black/dark border for contrast */
            .tile-borders.light-mode .bg-gray-700 {
                border: 2px solid rgba(0, 0, 0, 0.5) !important;
            }
        `}</style>
    );
};

const AppContent = () => {
  const { isAudioUnlocked, unlockAudio, ipFilterEnabled, allowedIPs, activePanelId, panels } = useDashboard();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAuthorized, setAuthorized] = useState<boolean | null>(null);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const auth = useAuth();
  
  const searchParams = new URLSearchParams(location.search);
  const isHeadless = searchParams.get('headless') === 'true';

  // Handle one-time device token provisioning from URL
  useEffect(() => {
      // Check both hash params (React Router) and root params (Window)
      const routerParams = new URLSearchParams(location.search);
      const windowParams = new URLSearchParams(window.location.search);
      
      const token = routerParams.get('token') || routerParams.get('key') || routerParams.get('authToken') ||
                    windowParams.get('token') || windowParams.get('key') || windowParams.get('authToken');

      if (token) {
          console.log("Device auth token found in URL. Provisioning device...", token);
          localStorage.setItem(DEVICE_AUTH_TOKEN_KEY, token);
          
          // Clean URL and Force Reload to ensure all services pick up the new token immediately
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('token');
          cleanUrl.searchParams.delete('key');
          cleanUrl.searchParams.delete('authToken');
          
          // If it was in the hash, we need to strip it manually or just rely on the reload
          // to reset state. Ideally, we strip it from the hash too.
          const cleanHash = window.location.hash.replace(/(\?|&)(token|key|authToken)=[^&]*/gi, '');
          
          window.location.href = `${cleanUrl.origin}${cleanUrl.pathname}${cleanHash}`;
      }
  }, [location]);

  // Auto-bootstrap a long-lived device token on first load if missing.
  // Runs once on mount; no-ops if a device token already exists. See
  // services/api.ts bootstrapDeviceToken for details (#162 follow-up).
  useEffect(() => {
    bootstrapDeviceToken();
  }, []);

  useEffect(() => {
    const checkIp = async () => {
        // Admin and login pages are not subject to IP filtering
        if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/login')) {
            setAuthorized(true);
            return;
        }
        
        // If a device token exists, we generally consider them authorized (authenticated),
        // but we still run the IP check to populate clientIp for the AccessDenied screen if needed.
        const hasToken = !!localStorage.getItem(DEVICE_AUTH_TOKEN_KEY);

        // REVERTED AUTH LOGIC: If IP filter is disabled, allow everyone.
        if (!ipFilterEnabled) {
            setAuthorized(true);
            return;
        }

        // Always fetch IP for logging/display
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            if (!response.ok) throw new Error('Failed to fetch IP');
            const data = await response.json();
            const ip = data.ip;
            setClientIp(ip);

            if (ipFilterEnabled) {
                const isAllowed = allowedIPs.some(allowed => allowed.ip === ip);
                // If valid token exists, allow bypass. If not, check IP whitelist.
                if (hasToken) {
                    setAuthorized(true);
                } else {
                    setAuthorized(isAllowed); 
                }
            } else {
                setAuthorized(true);
            }
        } catch (error) {
            console.error("IP check failed:", error);
            setClientIp('Error');
            // If fetch fails but IP filter is enabled, we should probably fail safe unless they have a token
            if (hasToken || !ipFilterEnabled) {
                setAuthorized(true);
            } else {
                setAuthorized(false);
            }
        }
    };

    checkIp();
  }, [ipFilterEnabled, allowedIPs, location.pathname]);
  
  // Heartbeat to validate device tokens and revoke access if deleted from the server.
  useEffect(() => {
    const deviceToken = localStorage.getItem(DEVICE_AUTH_TOKEN_KEY);

    // CHANGE: Only run heartbeat validation IF IP filtering is enabled.
    // If IP filtering is disabled, we don't care if the token is valid or not,
    // because access is permissive anyway. This prevents infinite reload loops
    // on legacy panels with broken tokens.
    if (!ipFilterEnabled || !deviceToken || auth.isAuthenticated) {
        return;
    }

    const validateToken = async () => {
        try {
            // apiValidateDeviceToken will use the device token from localStorage
            // via the fetch helper in api.ts
            await apiValidateDeviceToken();
        } catch (error) {
            console.warn('[Heartbeat] Device token is no longer valid. Revoking client access.', error);
            localStorage.removeItem(DEVICE_AUTH_TOKEN_KEY);
            // Force a reload. The app will redirect to /login because there's no token.
            window.location.reload();
        }
    };

    // Run once on initial load to immediately catch revoked tokens
    validateToken();

    // Set up the periodic check (10 minutes)
    const intervalId = setInterval(validateToken, 10 * 60 * 1000);

    // Clean up the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, [auth.isAuthenticated, ipFilterEnabled]);


  // Show a global loading indicator while checking auth status
  if (auth.isLoading) {
      return (
          <div className="flex items-center justify-center h-screen">
              <p className="text-gray-400 text-lg">Loading session...</p>
          </div>
      );
  }

  // IP filter check for non-admin/login pages
  // Note: Authorization check is loose here to prevent locking out existing panels.
  // Security relies on the API server rejecting requests without a valid token.
  const isDashboardRoute = !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/login');
  
  if (isAuthorized === null && isDashboardRoute) {
      return (
          <div className="flex items-center justify-center h-screen">
              <p className="text-gray-400 text-lg">Verifying access...</p>
          </div>
      );
  }

  if (isAuthorized === false && isDashboardRoute) {
      return <AccessDenied clientIp={clientIp} />;
  }
  
  // Dynamic resize: fill the screen edge-to-edge with NO scrolling and NO
  // letterbox bands. The dashboard grid stretches to fit the viewport (fluid
  // columns + rows that divide the available height), so the whole panel is
  // always visible and uses the full screen on browser, phone, iPad, and the HA
  // sidebar panel. The native iPad shell (window.__bpanelsNative) scales itself;
  // Admin/login are not dashboards and keep the normal scrolling layout.
  const isNativeShell = typeof window !== 'undefined' && (window as any).__bpanelsNative === true;
  const fillScreen = isDashboardRoute && !isNativeShell;

  // A DEFINITE viewport height (h-screen) gives the grid's `1fr` rows a fixed
  // box to divide, so the panel fills the screen exactly and content-heavy tiles
  // (News, etc.) stay constrained and scroll internally instead of ballooning.
  const chromeClass = "flex flex-col h-screen antialiased";

  // Bespoke compilation panels (e.g. the Kitchen room view) are full-bleed
  // surfaces that carry their OWN hero + bottom nav, so the global Header would
  // double up the chrome. Suppress it (and the grid padding) for those panels.
  // Additive: every other panel keeps the standard Header + padded main.
  const activePanel = panels.find(p => p.id === activePanelId);
  const isCompilationPanel = isDashboardRoute && !!activePanel?.compilationKind;

  const mainContainerClass = isCompilationPanel
    ? "flex-1 overflow-hidden" // full-bleed; the compilation panel owns the viewport
    : fillScreen
    ? "flex-1 overflow-hidden p-2" // fill the viewport; grid stretches, no scroll
    : (isNativeShell
        ? "flex-1 overflow-y-auto p-2" // native iPad kiosk: native scaling handles fit
        : "flex-1 overflow-y-auto container mx-auto p-6 md:p-8"); // Admin/etc.

  return (
    <>
      <ThemeManager activePanelId={activePanelId} />
      <NotificationHost />
      <GlobalSoundPlayer />
      {/* Audio unlock is only relevant to the dashboard (TTS alerts). Don't show
          its full-screen overlay over /admin or /login, where it would sit on top
          (z-100) and silently swallow the first click on every control. */}
      {!isAudioUnlocked && isDashboardRoute && <AudioUnlockModal onUnlock={unlockAudio} />}
       <div className={chromeClass}>
          {!isCompilationPanel && <Header />}
          <main className={mainContainerClass}>
              <AppRoutes />
          </main>
       </div>
       <VersionFooter />
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <DashboardProvider>
          <HashRouter>
              {/* LIFE-SAFETY TAKEOVER (Increment 10) — mounted ABOVE the scoped
                  router as a sibling to AppContent, so it renders on EVERY route/
                  panel/device including PIN-locked + pool-only/guest scoped panels,
                  AND survives every AppContent early-return (loading session,
                  access-denied, verifying-access). Global, non-dismissible,
                  overrides scoping/PIN. Driven PURELY by the REAL
                  alarm_control_panel.house state (+ open_sensors). DISPLAY +
                  ANNUNCIATION ONLY — issues ZERO service calls. Publishes its
                  active flag so the shell idle-return is suppressed mid-takeover. */}
              <LifeSafetyTakeover onActiveChange={setTakeoverActive} />
              <AppContent />
          </HashRouter>
      </DashboardProvider>
    </AuthProvider>
  );
}

export default App;