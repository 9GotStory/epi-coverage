import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Issue #159: a Session End (CONTEXT.md §51) takes the User to the LoginScreen from any route, including
 * the public dashboard. It wraps every route so it stays mounted on /login: the redirect fires once per
 * Session End and the User may still leave the LoginScreen afterwards.
 */
export function SessionEndRedirect() {
  const { sessionEnded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (sessionEnded) navigate('/login', { replace: true });
  }, [sessionEnded, navigate]);

  return <Outlet />;
}
