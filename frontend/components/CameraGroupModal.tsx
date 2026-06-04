

import React, { useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Device, DeviceType, DeviceService } from '../types';
import { IconX } from './icons';
import { useDashboard } from '../hooks/useDashboard';
import VideoStream from './VideoStream';

interface CameraGroupModalProps {
  device: Device; // This is the CameraGroup device
  onClose: () => void;
}

const CameraGroupModal = ({ device, onClose }: CameraGroupModalProps) => {
    const { deviceMap, connections } = useDashboard();
    const cameraIds: string[] = (device.state as any)?.cameraIds || [];
    
    const rtspConnection = useMemo(() => connections.find(c => c.id === DeviceService.RTSP && c.enabled), [connections]);

    const cameras = useMemo(() => 
        cameraIds
        .map(id => deviceMap.get(id))
        .filter((d): d is Device => !!d && d.type === DeviceType.Camera)
        .map(cam => {
            const rtspStreamUrl = (cam.state as any)?.rtspStreamUrl;
            let finalStreamUrl = (cam.state as any)?.streamUrl || rtspStreamUrl; // Fallback

            if (rtspConnection && rtspConnection.cloudEndpoint && rtspStreamUrl) {
                try {
                    const relayUrl = rtspConnection.cloudEndpoint.replace(/\/+$/, '');
                    // Generate path key from sanitized name, matching the config generation logic
                    const pathKey = cam.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
                    finalStreamUrl = `${relayUrl}/cam-${pathKey}/index.m3u8`;
                } catch (e) {
                    console.error("Invalid RTSP URL for camera in group:", cam.name, e);
                    finalStreamUrl = null; // Invalidate stream if URL is bad
                }
            }
            return { ...cam, finalStreamUrl };
        })
    , [cameraIds, deviceMap, rtspConnection]);


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
    
    const count = cameras.length;
    let gridClasses = 'grid-cols-1 grid-rows-1';
    
    if (count === 2) gridClasses = 'grid-cols-2 grid-rows-1';
    if (count === 3 || count === 4) gridClasses = 'grid-cols-2 grid-rows-2';
    if (count >= 5 && count <= 6) gridClasses = 'grid-cols-3 grid-rows-2';
    if (count >= 7 && count <= 9) gridClasses = 'grid-cols-3 grid-rows-3';
    if (count > 9) gridClasses = 'grid-cols-4 grid-rows-4';


    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4"
            onClick={onClose}
        >
            <div 
                className="bg-gray-900 rounded-lg shadow-xl w-full h-full max-w-7xl max-h-[95vh] flex flex-col" 
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-2 bg-gray-800 rounded-t-lg flex-shrink-0">
                    <h3 className="text-lg font-semibold text-white truncate pl-2">{device.name}</h3>
                    <button 
                        onClick={onClose}
                        className="p-2.5 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white active:scale-95 transition-all"
                        aria-label="Close camera group view"
                    >
                        <IconX className="w-6 h-6" />
                    </button>
                </div>
                <div className={`flex-1 p-1 sm:p-2 grid ${gridClasses} gap-1 sm:gap-2 bg-black min-h-0`}>
                    {cameras.map(cam => (
                        <div key={cam.id} className="relative bg-black rounded-md overflow-hidden">
                           {cam.finalStreamUrl && <VideoStream streamUrl={cam.finalStreamUrl} />}
                           <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1 text-center text-white text-xs font-semibold truncate pointer-events-none">
                               {cam.name}
                            </div>
                        </div>
                    ))}
                    {count === 0 && (
                        <div className="col-span-full row-span-full flex items-center justify-center text-gray-400">
                            This group has no cameras assigned.
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default CameraGroupModal;