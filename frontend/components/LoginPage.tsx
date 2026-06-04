import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconShield } from './icons';

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const from = (location.state as any)?.from?.pathname || '/admin';

    // Use an effect to navigate only after the authentication state has been updated.
    // This prevents a race condition where the app navigates before the state change
    // is reflected, causing the protected route to redirect back to login.
    useEffect(() => {
        if (auth.isAuthenticated) {
            navigate(from, { replace: true });
        }
    }, [auth.isAuthenticated, navigate, from]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        try {
            await auth.login(username, password);
            // Navigation is now handled by the useEffect hook
        } catch (err: any) {
            setError(err.message || 'Failed to log in.');
            setIsSubmitting(false); // Only stop submitting on error
        }
        // Don't set isSubmitting to false on success, as the component will unmount.
    };

    // The login form is disabled while the auth context is performing its initial
    // session validation OR while the form is actively being submitted.
    const isLoading = auth.isLoading || isSubmitting;

    return (
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
            <div className="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-lg shadow-lg">
                <div className="text-center">
                    <IconShield className="w-16 h-16 mx-auto text-brand-blue" />
                    <h2 className="mt-6 text-3xl font-extrabold text-white">
                        Admin Login
                    </h2>
                    <p className="mt-2 text-sm text-gray-400">
                        Enter credentials to access the admin panel.
                    </p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div className="rounded-md shadow-sm">
                         <div>
                            <label htmlFor="username-address" className="sr-only">Username</label>
                            <input
                                id="username-address"
                                name="username"
                                type="text"
                                autoComplete="username"
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-600 bg-gray-700 text-white rounded-t-md focus:outline-none focus:ring-brand-blue focus:border-brand-blue focus:z-10 sm:text-sm"
                                placeholder="Username"
                                disabled={isLoading}
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="sr-only">Password</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-600 bg-gray-700 text-white rounded-b-md focus:outline-none focus:ring-brand-blue focus:border-brand-blue focus:z-10 sm:text-sm"
                                placeholder="Password"
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-center text-red-400">{error}</p>
                    )}

                    <div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-blue hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-brand-blue disabled:bg-gray-600 disabled:opacity-50 transition-colors"
                        >
                            {isLoading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </div>
                </form>
                 <div className="text-center text-xs text-gray-500 pt-4">
                    <p>Default credentials are <span className="font-mono">admin</span> / <span className="font-mono">password</span>.</p>
                    <p>If login fails, try using the password reset script.</p>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;