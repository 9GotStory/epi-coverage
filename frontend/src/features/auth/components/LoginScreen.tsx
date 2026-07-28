import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useGoogleLogin, type TokenResponse } from '@react-oauth/google';
import { useAuth } from '../../../shared/contexts/AuthContext';
import { fetchApi } from '../../../shared/lib/api';

export function LoginScreen() {
  const { login, user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loginWithGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse: TokenResponse) => {
      setIsLoading(true);
      setError('');
      
      try {
        const accessToken = tokenResponse.access_token;
        if (!accessToken) throw new Error('No access token received');

        // Note: For 'implicit' flow, we get an access_token, not an id_token.
        // We pass this to our secure backend to verify and create a session.
        const res = await fetchApi('loginWithGoogle', {
          accessToken,
          userAgent: navigator.userAgent
        });

        if (res.data?.success) {
          if (res.data.isNewUser) {
            // New user -> navigate to First-Time Setup and pass google data
            navigate('/setup', { state: { googleData: res.data.googleData }, replace: true });
          } else if (res.data.status === 'pending') {
            navigate('/pending', { replace: true });
          } else if (res.data.status === 'approved' || res.data.user?.role === 'admin' || res.data.user?.role === 'superadmin') {
            login(res.data.user, res.data.session_id);
            navigate('/dashboard', { replace: true });
          } else {
            setError('Account rejected or suspended.');
          }
        } else {
          setError(res.data?.error || 'Login failed from server.');
        }

      } catch (err: any) {
        setError(err.message || 'Login failed. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    onError: (errorResponse) => {
      console.error('Login Failed:', errorResponse);
      setError('Google Sign-In was unsuccessful.');
    },
  });

  // Redirect if already logged in
  if (!authLoading && user) {
    if (user.status === 'pending') return <Navigate to="/pending" replace />;
    if (user.status === 'approved') return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center">
        <div className="mb-8">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            EPI
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight mb-2">Welcome Back</h1>
          <p className="text-slate-500 text-[15px]">Sign in to manage EPI coverage data</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        <div className="flex justify-center relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded-xl">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          )}
          <button
            onClick={() => loginWithGoogle()}
            disabled={isLoading}
            className="w-full max-w-[280px] bg-white border border-slate-200 text-slate-700 font-medium py-3 px-4 rounded-full flex items-center justify-center gap-3 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
