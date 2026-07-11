import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import type { JSX } from 'react';

type AppRole = 'admin' | 'sdr' | 'gerente' | 'motorista';

interface ProtectedRouteProps {
  roles: AppRole[];
  children: JSX.Element;
}

/**
 * Fail-closed: nega acesso quando o usuário não está autenticado, quando a role
 * ainda não foi carregada mas o loading terminou, ou quando a role não está na
 * lista permitida. Nunca libera acesso "por padrão" quando a role é null.
 */
export function ProtectedRoute({ roles, children }: ProtectedRouteProps) {
  const { role, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!role || !roles.includes(role)) return <Navigate to="/auth" replace />;

  return children;
}
