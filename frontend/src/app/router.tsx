import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from '../shared/components/ProtectedRoute';
import { AppLayout } from './layouts/AppLayout';
import { AdminDashboard } from '../features/admin/components/AdminDashboard';
import { UploadDashboard } from '../features/upload/components/UploadDashboard';
import { EpiDashboard } from '../features/vaccine-1yr/components/EpiDashboard';
import { EpiDashboard2Yr } from '../features/vaccine-2yr/components/EpiDashboard2Yr';
import { EpiDashboard3Yr } from '../features/vaccine-3yr/components/EpiDashboard3Yr';
import { EpiDashboard5Yr } from '../features/vaccine-5yr/components/EpiDashboard5Yr';

// Lazy loading components
const AppRoot = lazy(() => import('../App'));
const LoginScreen = lazy(() => import('../features/auth/components/LoginScreen').then(m => ({ default: m.LoginScreen })));
const PendingScreen = lazy(() => import('../features/auth/components/PendingScreen').then(m => ({ default: m.PendingScreen })));
const FirstTimeSetup = lazy(() => import('../features/auth/components/FirstTimeSetup').then(m => ({ default: m.FirstTimeSetup })));

const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex h-screen items-center justify-center text-primary"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
    {children}
  </Suspense>
);

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <SuspenseWrapper><LoginScreen /></SuspenseWrapper>
  },
  {
    path: '/pending',
    element: <SuspenseWrapper><PendingScreen /></SuspenseWrapper>
  },
  {
    path: '/setup',
    element: <SuspenseWrapper><FirstTimeSetup /></SuspenseWrapper>
  },
  {
    path: '/',
    element: <SuspenseWrapper><AppRoot /></SuspenseWrapper>,
    children: [
      {
        path: '',
        element: <Navigate to="/dashboard" replace />
      },
      {
        element: <AppLayout />,
        children: [
          {
            element: <ProtectedRoute />,
            children: [
              {
                path: 'dashboard',
                element: <div>Dashboard (Protected)</div>
              },
              {
                element: <ProtectedRoute allowedRoles={['superadmin', 'admin', 'user']} />,
                children: [
                  {
                    path: 'dashboard/epi-1yr',
                    element: <EpiDashboard />
                  },
                  {
                    path: 'dashboard/epi-2yr',
                    element: <EpiDashboard2Yr />
                  },
                  {
                    path: 'dashboard/epi-3yr',
                    element: <EpiDashboard3Yr />
                  },
                  {
                    path: 'dashboard/epi-5yr',
                    element: <EpiDashboard5Yr />
                  }
                ]
              },
              {
                element: <ProtectedRoute allowedRoles={['admin', 'superadmin']} />,
                children: [
                  {
                    path: 'admin',
                    element: <AdminDashboard />
                  }
                ]
              },
              {
                element: <ProtectedRoute allowedHoscodes={['00588']} />,
                children: [
                  {
                    path: 'upload',
                    element: <UploadDashboard />
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
]);
