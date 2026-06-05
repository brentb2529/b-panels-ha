import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Device, TileConfig } from '../../types';
import TileWrapper from './TileWrapper';
import { IconRss, IconRefreshCw, IconAlertTriangle, IconX, IconArrowRight } from '../icons';
import { apiFetchRssFeed } from '../../services/api';
import { fluidIcon, fluidTextSm, fluidTextXs, fluidGap } from './tileScale';

interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
}

const formatDate = (dateString: string) => {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        // show as 'Mon, Jan 1'
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

const NewsModal = ({ item, onClose }: { item: FeedItem; onClose: () => void }) => {
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Post-process injected HTML to ensure links open in new tabs and images are responsive
    useEffect(() => {
        if (contentRef.current) {
            const links = contentRef.current.querySelectorAll('a');
            links.forEach(link => {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                link.classList.add('text-brand-blue', 'hover:underline');
            });
            
            const images = contentRef.current.querySelectorAll('img');
            images.forEach(img => {
                img.classList.add('max-w-full', 'h-auto', 'rounded-md', 'my-4');
                // Remove fixed dimensions if they break layout
                img.removeAttribute('width');
                img.removeAttribute('height');
                img.style.height = 'auto';
            });
        }
    }, [item.description]);

    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
            onClick={onClose}
        >
            <div 
                className="bg-gray-900 w-full max-w-3xl max-h-[90vh] rounded-lg shadow-2xl flex flex-col border border-gray-700 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700 shrink-0">
                    <h3 className="text-lg font-bold text-white truncate flex-1 pr-4" title={item.title}>
                        {item.title}
                    </h3>
                    <div className="flex items-center gap-2">
                        <a 
                            href={item.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 bg-gray-700 hover:bg-brand-blue text-gray-300 hover:text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1"
                            title="Open source in new tab"
                        >
                            <span className="hidden sm:inline">Open Source</span>
                            <IconArrowRight className="w-4 h-4" />
                        </a>
                        <button 
                            onClick={onClose}
                            className="p-2 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white"
                            aria-label="Close"
                        >
                            <IconX className="w-6 h-6" />
                        </button>
                    </div>
                </div>
                
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-900 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-800">
                     <div 
                        ref={contentRef}
                        className="text-gray-300 space-y-4 leading-relaxed text-base"
                        dangerouslySetInnerHTML={{ __html: item.description || '<p class="italic text-gray-500">No preview available. Click "Read full story" to view.</p>' }} 
                     />
                     
                     <div className="mt-8 pt-6 border-t border-gray-700">
                        <a 
                            href={item.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-blue text-white rounded-md hover:bg-blue-600 transition-colors font-medium shadow-lg"
                        >
                            Read full story <IconArrowRight className="w-4 h-4" />
                        </a>
                     </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const RSSFeedTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  
  // Robust backward compatibility: state can be a string (old) or an object (new)
  const url = typeof device.state === 'string' 
    ? device.state 
    : (device.state && typeof device.state === 'object' && (device.state as any).url) || null;

  const refresh = (device.state && typeof device.state === 'object' && (device.state as any).refresh) || 900; // Default to 15 mins if not set

  useEffect(() => {
    if (isEditor) {
      setLoading(false);
      setError("RSS Feed is disabled in editor mode.");
      setItems([]);
      return;
    }
    
    if (!url) {
      setError("RSS Feed URL is not configured.");
      setLoading(false);
      return;
    }

    const CACHE_KEY = `rss-feed-cache-${url}`;
    const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

    const fetchFeed = async () => {
      // Only show full loading state if we have no items to display
      setItems(currentItems => {
          if (currentItems.length === 0) {
              setLoading(true);
          }
          return currentItems;
      });
      
      try {
        // Routed through api-server's /api/rss-proxy (CORS-safe, auth'd via
        // device/admin token). Replaced the third-party corsproxy.io that
        // started 403'ing unknown origins.
        const text = await apiFetchRssFeed(url);
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        
        const errorNode = xml.querySelector('parsererror');
        if (errorNode) {
          throw new Error('Failed to parse RSS/XML feed. Check format.');
        }

        const feedItems: FeedItem[] = [];
        const itemNodes = xml.querySelectorAll('item'); // Standard RSS
        const entryNodes = xml.querySelectorAll('entry'); // Atom feeds
        
        const nodesToParse = itemNodes.length > 0 ? itemNodes : entryNodes;

        nodesToParse.forEach(item => {
          const title = item.querySelector('title')?.textContent || '';
          // Handle Atom link tags which are attributes
          let link = item.querySelector('link')?.textContent || '';
          if (!link) {
              const linkNode = item.querySelector('link');
              link = linkNode?.getAttribute('href') || '';
          }
          
          const pubDate = item.querySelector('pubDate')?.textContent || item.querySelector('published')?.textContent || '';
          
          // Extract description/content
          let description = item.querySelector('description')?.textContent || '';
          const contentEncoded = item.getElementsByTagNameNS('*', 'encoded')[0]?.textContent; // content:encoded
          const summary = item.querySelector('summary')?.textContent; // Atom summary
          
          // Prefer full content if available, fallback to description/summary
          if (contentEncoded) description = contentEncoded;
          else if (!description && summary) description = summary;

          // Basic HTML cleanup (optional, browser DOMParser helps sanitization naturally when setting innerHTML but scripts can persist)
          // Note: For this dashboard, we assume trusted feeds.

          if (title && link) {
            feedItems.push({ title, link, pubDate, description });
          }
        });
        
        const newItems = feedItems.slice(0, 25);
        setItems(newItems);
        setError(null); // Clear previous errors on a successful fetch

        // Cache successful result
        const cacheData = { items: newItems, timestamp: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        
      } catch (e: any) {
        console.warn(`[RSS Tile] Fetch failed: ${e.message}. Showing stale data if available.`);
        // On error, only show it if we have no existing items to display
        setItems(currentItems => {
            if (currentItems.length === 0) {
                setError(e.message);
            }
            return currentItems;
        });
      } finally {
        setLoading(false);
      }
    };

    // Immediately try to load from cache for a fast initial render
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            const { items: cachedItems, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_DURATION_MS) {
                setItems(cachedItems);
                setLoading(false);
            }
        }
    } catch(e) {
        console.warn('Could not read or parse RSS cache.', e);
        localStorage.removeItem(CACHE_KEY);
    }
    
    fetchFeed(); // Fetch fresh data on mount
    
    const interval = setInterval(fetchFeed, refresh * 1000);
    return () => clearInterval(interval);

  }, [url, refresh, isEditor]);
  
  const renderContent = () => {
      if (loading) {
          return (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-300" style={fluidGap(0.5)}>
                  <IconRefreshCw className="animate-spin" style={fluidIcon(2)} />
                  <p style={fluidTextSm}>Loading Feed...</p>
              </div>
          );
      }
      if (error) {
           return (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-yellow-300 p-2" style={fluidGap(0.5)}>
                  <IconAlertTriangle style={fluidIcon(2)} />
                  <p className="font-semibold" style={fluidTextSm}>Feed Error</p>
                  <p className="text-yellow-400" style={fluidTextXs}>{error}</p>
              </div>
          );
      }
      if (items.length === 0) {
          return (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-300" style={fluidGap(0.5)}>
                  <IconRss style={fluidIcon(2)} />
                  <p style={fluidTextSm}>No items in feed.</p>
              </div>
          );
      }
      return (
           <ul className="overflow-y-auto h-full pr-1 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent" style={fluidGap(0.375)}>
              {items.map((item, index) => (
                  <li key={index} className="mb-1.5 last:mb-0">
                      <div
                        onClick={() => !isEditor && setSelectedItem(item)}
                        className={`relative block text-left p-2 pl-3 rounded-control bg-white/[0.03] hover:bg-white/[0.07] transition-colors ${!isEditor ? 'cursor-pointer' : ''}`}
                        style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06)' }}
                        role="button"
                        tabIndex={0}
                      >
                          {/* Accent rail gives each headline a crisp, dimensional left edge */}
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-blue/70" />
                          <p className="font-semibold text-gray-100 leading-snug overflow-hidden" style={{ ...fluidTextSm, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.title}</p>
                          {item.pubDate && <p className="text-gray-400 mt-0.5 tabular-nums" style={fluidTextXs}>{formatDate(item.pubDate)}</p>}
                      </div>
                  </li>
              ))}
          </ul>
      );
  };

  return (
    <>
        <TileWrapper
            label={tile.label || device.name}
            isLocked={tile.isLocked}
            isEditor={isEditor}
            className={cornerClassName}
        >
            <div className="w-full h-full flex flex-col overflow-hidden p-1.5">
                {renderContent()}
            </div>
        </TileWrapper>
        {selectedItem && (
            <NewsModal 
                item={selectedItem} 
                onClose={() => setSelectedItem(null)} 
            />
        )}
    </>
  );
};

export default RSSFeedTile;