import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import { fetchApi } from '../lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** Issue #159: the server ended this Session without a Sign-out (a Session End, CONTEXT.md §51). Held in memory only. */
  sessionEnded: boolean;
  clearSessionEnded: () => void;
  login: (userData: User, token: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Issue #159: whether this tab holds a Session, updated synchronously so a 401 that answers the
  // Sign-out's own deleteSession (or arrives after it) is not taken for a Session End
  const hasSession = useRef(false);

  // Load session from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const storedToken = localStorage.getItem('token');
    
    if (storedUser && storedToken) {
      setUser(JSON.parse(storedUser));
      setToken(storedToken);
      hasSession.current = true;
    }
    setIsLoading(false);

    // Global listener for 401 Unauthorized API responses
    const handleUnauthorized = () => {
      if (hasSession.current) setSessionEnded(true);
      hasSession.current = false;
      setUser(null);
      setToken(null);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      // No need to redirect via window.location.href! 
      // Setting state to null will automatically re-render the app and the React Router will show LoginScreen.
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback((userData: User, authToken: string) => {
    hasSession.current = true;
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', authToken);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      // Background logout
      fetchApi('deleteSession', { token }).catch(console.error);
    }
    hasSession.current = false;
    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }, [token]);

  const clearSessionEnded = useCallback(() => setSessionEnded(false), []);

  const value = useMemo(() => ({
    user,
    token,
    isLoading,
    sessionEnded,
    clearSessionEnded,
    login,
    logout
  }), [user, token, isLoading, sessionEnded, clearSessionEnded, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
