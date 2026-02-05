import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type AppRole = 'admin' | 'sdr' | 'gerente' | 'motorista';

export function useRoleGuard(allowedRoles: AppRole[], redirectTo: string = '/dashboard') {
  const { role, loading, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      navigate('/auth');
      return;
    }

    if (role && !allowedRoles.includes(role)) {
      navigate(redirectTo);
    }
  }, [role, loading, user, allowedRoles, redirectTo, navigate]);

  return { isAllowed: role ? allowedRoles.includes(role) : false, loading };
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
