import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type AppRole = 'admin' | 'sdr' | 'gerente' | 'motorista';

/**
 * Fail-closed: se o usuário estiver sem role definida (ou role fora da lista),
 * redireciona. Nunca considera "sem role" como acesso permitido.
 */
export function useRoleGuard(allowedRoles: AppRole[], redirectTo: string = '/auth') {
  const { role, loading, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/auth');
      return;
    }
    if (!role || !allowedRoles.includes(role)) {
      navigate(redirectTo);
    }
  }, [role, loading, user, allowedRoles, redirectTo, navigate]);

  return { isAllowed: !!role && allowedRoles.includes(role), loading };
}

export function useAuthGuard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  return { isAuthenticated: !!user, loading };
}
