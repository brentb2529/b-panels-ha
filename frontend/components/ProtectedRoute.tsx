import React, { ReactNode } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// FIX: Made children optional to resolve "Property 'children' is missing" error at usage sites, likely due to a TS/JSX configuration issue.
const ProtectedRoute = ({ children }: { children?: ReactNode }) => {
    const auth = useAuth();
    const location = useLocation();

    if (auth.isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-400 text-lg">Authenticating...</p>
            </div>
        );
    }

    if (!auth.isAuthenticated) {
        // Redirect them to the /login page, but save the current location they were
        // trying to go to. This allows us to send them along to that page after they
        // log in, which is a better user experience.
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;