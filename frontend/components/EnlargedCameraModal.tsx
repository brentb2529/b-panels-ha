

import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { Device, DeviceService } from '../types';
import { IconX } from './icons';
import { useDashboard } from '../hooks/useDashboard';
import * as haClient from '../services/haClient';
import VideoStream from './VideoStream';

interface EnlargedCameraModalProps {
  device: Device;
  onClose: () => void;
}

const EnlargedCameraModal = ({ device, onClose }: EnlargedCameraModalProps) => {
    const { connections } = useDashboard();
    const isHaCamera = device.service === DeviceService.HomeAssistant;
    const rtspStreamUrl = (device.state as any)?.rtspStreamUrl;

    const legacyHlsUrl = useMemo(() => {
        const rtspConnection = connections.find(c => c.id === DeviceService.RTSP && c.enabled);
        if (rtspConnection && rtspConnection.cloudEndpoint && rtspStreamUrl) {
            try {
                const relayUrl = rtspConnection.cloudEndpoint.replace(/\/+$/, '');
                const pathKey = device.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
                return `${relayUrl}/cam-${pathKey}/index.m3u8`;
            } catch (e) {
                console.error("Invalid RTSP URL:", rtspStreamUrl, e);
                return null;
            }
        }
        return (device.state as any)?.streamUrl || rtspStreamUrl || null;
    }, [connections, rtspStreamUrl, device.name, device.state]);

    // HA cameras resolve their live HLS stream from HA; others use the legacy URL.
    const [haHlsUrl, setHaHlsUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!isHaCamera) return;
        let cancelled = false;
        haClient.getCameraStreamUrl(device.id)
            .then(url => { if (!cancelled) setHaHlsUrl(url); })
            .catch(err => { if (!cancelled) console.warn(`[Camera] HA stream failed for ${device.id}:`, err); });
        return () => { cancelled = true; };
    }, [isHaCamera, device.id]);

    const hlsUrl = isHaCamera ? haHlsUrl : legacyHlsUrl;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div 
                className="bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl aspect-video relative flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-2 bg-gray-800 rounded-t-lg">
                    <h3 className="text-lg font-semibold text-white">{device.name}</h3>
                    <button 
                        onClick={onClose}
                        className="p-2.5 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white active:scale-95 transition-all"
                        aria-label="Close enlarged view"
                    >
                        <IconX className="w-6 h-6" />
                    </button>
                </div>
                <div className="flex-1 relative bg-black">
                   {hlsUrl ? (
                        <VideoStream streamUrl={hlsUrl} />
                   ) : (
                        <div className="w-full h-full flex items-center justify-center text-red-400">
                            Stream URL not available.
                        </div>
                   )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default EnlargedCameraModal;