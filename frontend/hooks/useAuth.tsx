import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiLogin, apiLogout, apiGetCurrentUser } from '../services/api';
import { AdminUser } from '../types';

interface AuthContextType {
  user: AdminUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};

// FIX: Made children optional to resolve "Property 'children' is missing" error at usage sites, likely due to a TS/JSX configuration issue.
export const AuthProvider = ({ children }: { children?: ReactNode }) => {
    const [user, setUser] = useState<AdminUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Check for an existing session on initial application load
    useEffect(() => {
        const validateSession = async () => {
            setIsLoading(true);
            try {
                const currentUser = await apiGetCurrentUser();
                setUser(currentUser);
            } catch (e) {
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        };
        validateSession();
    }, []);

    const login = useCallback(async (username: string, password: string) => {
        setError(null);
        try {
            const { user: loggedInUser } = await apiLogin(username, password);
            if (!loggedInUser) {
                // This prevents a login loop if the API returns a token but no user object.
                throw new Error("Login failed: The server did not return user data.");
            }
            setUser(loggedInUser);
        } catch (e: any) {
            setError(e.message || 'Login failed');
            throw e; // Re-throw for the component to handle UI updates
        }
    }, []);

    const logout = useCallback(async () => {
        await apiLogout();
        setUser(null);
    }, []);

    const value = {
        user,
        login,
        logout,
        isAuthenticated: !!user,
        isLoading,
        error,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};