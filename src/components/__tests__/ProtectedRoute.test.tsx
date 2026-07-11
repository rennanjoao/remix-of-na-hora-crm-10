import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute';

const authState: {
  user: unknown; role: string | null; loading: boolean;
} = { user: null, role: null, loading: false };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

function renderWith(el: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/auth" element={<div>login</div>} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
        <Route path="/protected" element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute (fail-closed)', () => {
  beforeEach(() => {
    authState.user = null; authState.role = null; authState.loading = false;
  });

  it('sem sessão → redireciona para /auth', () => {
    renderWith(<ProtectedRoute roles={['admin']}><div>secret</div></ProtectedRoute>);
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('sessão SEM role → nega acesso (fail-closed) e vai para /auth', () => {
    authState.user = { id: 'u1' };
    authState.role = null;
    renderWith(<ProtectedRoute roles={['admin']}><div>secret</div></ProtectedRoute>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('role fora da lista → redireciona', () => {
    authState.user = { id: 'u1' };
    authState.role = 'sdr';
    renderWith(<ProtectedRoute roles={['admin']}><div>secret</div></ProtectedRoute>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('role permitida → renderiza filhos', () => {
    authState.user = { id: 'u1' };
    authState.role = 'admin';
    renderWith(<ProtectedRoute roles={['admin']}><div>secret</div></ProtectedRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});
