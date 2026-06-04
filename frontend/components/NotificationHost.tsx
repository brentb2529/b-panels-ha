

import React, { useState, useEffect } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { IconX, IconInfo, IconCheckCircle, IconAlertTriangle, IconXCircle } from './icons';
import { AppNotification } from '../types';

const Notification = ({ notification, onDismiss }: { notification: AppNotification, onDismiss: (id: number) => void }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
      // Use requestAnimationFrame to ensure the element is in the DOM before starting the transition
      const timer = requestAnimationFrame(() => {
        setIsVisible(true);
      });
      return () => cancelAnimationFrame(timer);
    }, []);


    const getIcon = () => {
        const iconProps = { className: "h-6 w-6" };
        switch(notification.type) {
            case 'success':
                return <IconCheckCircle {...iconProps} className={`${iconProps.className} text-green-400`} />;
            case 'warning':
                return <IconAlertTriangle {...iconProps} className={`${iconProps.className} text-yellow-400`} />;
            case 'error':
                return <IconXCircle {...iconProps} className={`${iconProps.className} text-red-400`} />;
            case 'info':
            default:
                return <IconInfo {...iconProps} className={`${iconProps.className} text-blue-400`} />;
        }
    };

    return (
        <div className={`w-full max-w-xl bg-gray-800 shadow-2xl rounded-lg pointer-events-auto flex border border-gray-600 overflow-hidden transform transition-all duration-300 ease-out ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
            <div className="flex-1 p-4">
                <div className="flex items-start">
                    <div className="flex-shrink-0 pt-0.5">
                       {getIcon()}
                    </div>
                    <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-white">{notification.message}</p>
                    </div>
                </div>
            </div>
            <div className="flex border-l border-gray-600">
                <button onClick={() => onDismiss(notification.id)} className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-gray-400 hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-blue">
                    <IconX className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
};


const NotificationHost = () => {
    const { notifications, removeNotification } = useDashboard();

    if (notifications.length === 0) {
        return null;
    }

    // The header is 4rem (h-16) tall. The container is positioned 6rem (top-24) from the
    // top of the viewport, ensuring it appears below the header with a clear 2rem gap.
    return (
        <div aria-live="assertive" className="fixed top-24 right-4 sm:right-6 flex flex-col items-end space-y-4 pointer-events-none z-[200]">
            {/* FIX: Wrap the Notification component in a div with the key prop to resolve a TypeScript error. */}
            {notifications.map(notification => (
                <div key={notification.id}>
                    <Notification notification={notification} onDismiss={removeNotification} />
                </div>
            ))}
        </div>
    );
};

export default NotificationHost;