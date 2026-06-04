
import React, { useState } from 'react';
import { IconShieldOff, IconArrowRight } from './icons';

interface AccessDeniedProps {
    clientIp: string | null;
}

const AccessDenied = ({ clientIp }: AccessDeniedProps) => {
    const [manualToken, setManualToken] = useState('');

    const handleTokenSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualToken.trim()) {
            localStorage.setItem('homeTileDeviceAuthToken', manualToken.trim());
            // Reload the page to apply the new token to all API services
            window.location.reload();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
                <IconShieldOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-white mb-2">Access Denied</h1>
                <p className="text-gray-300 mb-6">
                    Device authorization required.
                </p>
                
                <form onSubmit={handleTokenSubmit} className="mb-8">
                    <label className="block text-sm text-gray-400 mb-2 text-left font-medium">Enter Device Token</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={manualToken}
                            onChange={(e) => setManualToken(e.target.value)}
                            className="flex-1 bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-brand-blue focus:border-brand-blue placeholder-gray-600"
                            placeholder="Paste token here..."
                        />
                        <button type="submit" className="bg-brand-blue text-white px-3 py-2 rounded-md hover:bg-blue-500 transition-colors">
                            <IconArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 text-left">
                        You can find this token in the <strong>Admin Panel &gt; Device Auth</strong>.
                    </p>
                </form>

                {clientIp && (
                    <div className="bg-gray-900 rounded-md p-3 border border-gray-700">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Detected IP Address</p>
                        <p className="text-lg font-mono text-white font-semibold">{clientIp}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AccessDenied;
