import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { JSX } from 'react';

type AppRole = 'admin' | 'sdr' | 'gerente' | 'motorista';

interface ProtectedRouteProps {
  roles: AppRole[];
  children: JSX.Element;
}

export function ProtectedRoute({ roles, children }: ProtectedRouteProps) {
  const { role, loading, user } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (role && !roles.includes(role)) return <Navigate to="/dashboard" replace />;

  return children;
}
