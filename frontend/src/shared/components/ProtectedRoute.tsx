import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  allowedHoscodes?: string[];
}

export function ProtectedRoute({ allowedRoles, allowedHoscodes }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.status === 'pending') {
    return <Navigate to="/pending" replace />;
  }

  if (user.status === 'rejected') {
    // Or you could navigate to a rejected screen
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (allowedHoscodes && !allowedHoscodes.includes(user.hoscode)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
