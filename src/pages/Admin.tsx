import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, UserCog, Search, Shield, UserCheck, UserX } from 'lucide-react';
import { CreateUserDialog } from '@/components/admin/CreateUserDialog';
import { ScriptsManager } from '@/components/admin/ScriptsManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AppRole = 'admin' | 'sdr' | 'gerente' | 'motorista';

interface UserWithRole {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  role: AppRole;
  created_at: string;
}

export default function Admin() {
  const { isAllowed, loading: guardLoading } = useRoleGuard(['admin'], '/dashboard');
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Merge data
      const usersWithRoles = profiles?.map(profile => {
        const userRole = roles?.find(r => r.user_id === profile.user_id);
        return {
          ...profile,
          role: (userRole?.role as AppRole) || 'sdr',
        };
      }) || [];

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAllowed) {
      fetchUsers();
    }
  }, [isAllowed]);

  const updateUserRole = async (userId: string, newRole: AppRole) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);

      if (error) throw error;

      setUsers(prev => prev.map(u => 
        u.user_id === userId ? { ...u, role: newRole } : u
      ));
      toast.success('Cargo atualizado com sucesso');
    } catch (error) {
      console.error('Error updating role:', error);
      toast.error('Erro ao atualizar cargo');
    }
  };

  const toggleUserActive = async (userId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: isActive })
        .eq('user_id', userId);

      if (error) throw error;

      setUsers(prev => prev.map(u => 
        u.user_id === userId ? { ...u, is_active: isActive } : u
      ));
      toast.success(isActive ? 'Usuário ativado' : 'Usuário desativado');
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const filteredUsers = users.filter(user =>
    user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: AppRole) => {
    const variants: Record<AppRole, { label: string; className: string }> = {
      admin: { label: 'Admin', className: 'bg-accent text-accent-foreground' },
      sdr: { label: 'SDR', className: 'bg-blue-500 text-white' },
      gerente: { label: 'Gerente', className: 'bg-purple-500 text-white' },
      motorista: { label: 'Motorista', className: 'bg-orange-500 text-white' },
    };
    const variant = variants[role];
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  if (guardLoading || loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isAllowed) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">Administração</h1>
            <p className="text-muted-foreground mt-1">
              Gerencie usuários e permissões do sistema
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            <span>Acesso restrito a administradores</span>
          </div>
        </div>

        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="scripts">Scripts de Abordagem</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserCog className="h-5 w-5" />
                  Usuários do Sistema
                </CardTitle>
                <CardDescription>{users.length} usuários cadastrados</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar usuários..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <CreateUserDialog onCreated={fetchUsers} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name || 'Sem nome'}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.is_active ? (
                        <div className="flex items-center gap-1 text-success">
                          <UserCheck className="h-4 w-4" />
                          <span className="text-sm">Ativo</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-destructive">
                          <UserX className="h-4 w-4" />
                          <span className="text-sm">Inativo</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Dialog open={dialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setSelectedUser(null);
                      }}>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedUser(user)}
                          >
                            Editar
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Editar Usuário</DialogTitle>
                            <DialogDescription>
                              Altere o cargo e status do usuário
                            </DialogDescription>
                          </DialogHeader>
                          {selectedUser && (
                            <div className="space-y-6 pt-4">
                              <div className="space-y-2">
                                <Label>Nome</Label>
                                <p className="text-sm text-muted-foreground">{selectedUser.full_name}</p>
                              </div>
                              <div className="space-y-2">
                                <Label>E-mail</Label>
                                <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                              </div>
                              <div className="space-y-2">
                                <Label>Cargo</Label>
                                <Select
                                  value={selectedUser.role}
                                  onValueChange={(value: AppRole) => {
                                    updateUserRole(selectedUser.user_id, value);
                                    setSelectedUser({ ...selectedUser, role: value });
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Administrador</SelectItem>
                                    <SelectItem value="gerente">Gerente</SelectItem>
                                    <SelectItem value="sdr">SDR</SelectItem>
                                    <SelectItem value="motorista">Motorista</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-between">
                                <Label>Usuário Ativo</Label>
                                <Switch
                                  checked={selectedUser.is_active}
                                  onCheckedChange={(checked) => {
                                    toggleUserActive(selectedUser.user_id, checked);
                                    setSelectedUser({ ...selectedUser, is_active: checked });
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredUsers.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                Nenhum usuário encontrado
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="scripts">
            <ScriptsManager />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
