import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Search, Building2, Download, ExternalLink, Phone, Mail, MapPin } from 'lucide-react';

// Mock data for Brazilian companies (simulating API Minha Receita)
const MOCK_COMPANIES = [
  { cnpj: '12.345.678/0001-90', razao_social: 'Logística Express LTDA', nome_fantasia: 'Log Express', telefone: '(11) 98765-4321', email: 'contato@logexpress.com.br', cidade: 'São Paulo', estado: 'SP', cnae_codigo: '4930-2/01', cnae_descricao: 'Transporte rodoviário de carga' },
  { cnpj: '98.765.432/0001-10', razao_social: 'Transportadora Brasil S.A.', nome_fantasia: 'Trans Brasil', telefone: '(21) 99876-5432', email: 'comercial@transbrasil.com.br', cidade: 'Rio de Janeiro', estado: 'RJ', cnae_codigo: '4930-2/02', cnae_descricao: 'Transporte rodoviário de carga' },
  { cnpj: '11.222.333/0001-44', razao_social: 'Indústria Metalúrgica São Paulo LTDA', nome_fantasia: 'Metal SP', telefone: '(11) 3333-4444', email: 'vendas@metalsp.com.br', cidade: 'Guarulhos', estado: 'SP', cnae_codigo: '2599-3/99', cnae_descricao: 'Fabricação de produtos de metal' },
  { cnpj: '55.666.777/0001-88', razao_social: 'Distribuidora Nacional EIRELI', nome_fantasia: 'Distri Nacional', telefone: '(31) 99888-7766', email: 'pedidos@distrinacional.com.br', cidade: 'Belo Horizonte', estado: 'MG', cnae_codigo: '4639-7/01', cnae_descricao: 'Comércio atacadista de produtos alimentícios' },
  { cnpj: '33.444.555/0001-22', razao_social: 'Agronegócio Sul LTDA', nome_fantasia: 'Agro Sul', telefone: '(51) 98765-1234', email: 'contato@agrosul.com.br', cidade: 'Porto Alegre', estado: 'RS', cnae_codigo: '0111-3/01', cnae_descricao: 'Cultivo de arroz' },
  { cnpj: '77.888.999/0001-66', razao_social: 'Tecnologia Nordeste S.A.', nome_fantasia: 'TechNE', telefone: '(81) 99999-8888', email: 'info@techne.com.br', cidade: 'Recife', estado: 'PE', cnae_codigo: '6201-5/01', cnae_descricao: 'Desenvolvimento de programas de computador' },
  { cnpj: '22.333.444/0001-55', razao_social: 'Construtora Centro-Oeste LTDA', nome_fantasia: 'Constrói CO', telefone: '(62) 98877-6655', email: 'obras@constroico.com.br', cidade: 'Goiânia', estado: 'GO', cnae_codigo: '4120-4/00', cnae_descricao: 'Construção de edifícios' },
  { cnpj: '44.555.666/0001-33', razao_social: 'Farmácia Popular do Brasil LTDA', nome_fantasia: 'FarmaPop', telefone: '(85) 97766-5544', email: 'central@farmapop.com.br', cidade: 'Fortaleza', estado: 'CE', cnae_codigo: '4771-7/01', cnae_descricao: 'Comércio varejista de produtos farmacêuticos' },
];

const SETORES = [
  { value: 'all', label: 'Todos os setores' },
  { value: 'logistica', label: 'Logística e Transporte' },
  { value: 'industria', label: 'Indústria' },
  { value: 'comercio', label: 'Comércio' },
  { value: 'agro', label: 'Agronegócio' },
  { value: 'tecnologia', label: 'Tecnologia' },
  { value: 'construcao', label: 'Construção' },
  { value: 'saude', label: 'Saúde' },
];

const ESTADOS = [
  { value: 'all', label: 'Todos os estados' },
  { value: 'SP', label: 'São Paulo' },
  { value: 'RJ', label: 'Rio de Janeiro' },
  { value: 'MG', label: 'Minas Gerais' },
  { value: 'RS', label: 'Rio Grande do Sul' },
  { value: 'PR', label: 'Paraná' },
  { value: 'SC', label: 'Santa Catarina' },
  { value: 'BA', label: 'Bahia' },
  { value: 'PE', label: 'Pernambuco' },
  { value: 'CE', label: 'Ceará' },
  { value: 'GO', label: 'Goiás' },
];

interface Company {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  telefone: string;
  email: string;
  cidade: string;
  estado: string;
  cnae_codigo: string;
  cnae_descricao: string;
}

export default function Prospeccao() {
  const { isAllowed, loading: guardLoading } = useRoleGuard(['admin', 'sdr'], '/dashboard');
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [setor, setSetor] = useState('all');
  const [estado, setEstado] = useState('all');
  const [cidade, setCidade] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  const searchCompanies = () => {
    setLoading(true);
    
    // Simulate API delay
    setTimeout(() => {
      let filtered = [...MOCK_COMPANIES];

      if (searchTerm) {
        filtered = filtered.filter(c => 
          c.razao_social.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.cnpj.includes(searchTerm)
        );
      }

      if (estado !== 'all') {
        filtered = filtered.filter(c => c.estado === estado);
      }

      if (cidade) {
        filtered = filtered.filter(c => 
          c.cidade.toLowerCase().includes(cidade.toLowerCase())
        );
      }

      setCompanies(filtered);
      setLoading(false);
      toast.success(`${filtered.length} empresas encontradas`);
    }, 800);
  };

  const importToLeads = async (company: Company) => {
    if (!profile) return;
    
    setImporting(company.cnpj);
    try {
      // Check if lead already exists
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('cnpj', company.cnpj)
        .maybeSingle();

      if (existing) {
        toast.error('Esta empresa já está cadastrada como lead');
        setImporting(null);
        return;
      }

      // Import to leads
      const { error } = await supabase.from('leads').insert({
        cnpj: company.cnpj,
        razao_social: company.razao_social,
        nome_fantasia: company.nome_fantasia,
        telefone: company.telefone,
        email: company.email,
        cidade: company.cidade,
        estado: company.estado,
        cnae_codigo: company.cnae_codigo,
        cnae_descricao: company.cnae_descricao,
        setor: company.cnae_descricao,
        created_by: profile.id,
        assigned_to: profile.id,
        status: 'novo',
      });

      if (error) throw error;

      toast.success('Empresa importada para o CRM!');
      
      // Remove from list
      setCompanies(prev => prev.filter(c => c.cnpj !== company.cnpj));
    } catch (error) {
      console.error('Error importing lead:', error);
      toast.error('Erro ao importar empresa');
    } finally {
      setImporting(null);
    }
  };

  if (guardLoading) {
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
        <div>
          <h1 className="font-display text-3xl font-bold">Prospecção B2B</h1>
          <p className="text-muted-foreground mt-1">
            Busque empresas brasileiras e importe para seu CRM
          </p>
        </div>

        {/* Search Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Filtros de Busca
            </CardTitle>
            <CardDescription>
              Pesquise empresas por CNAE, setor, cidade ou estado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2">
                <Input
                  placeholder="Buscar por nome ou CNPJ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={setor} onValueChange={setSetor}>
                <SelectTrigger>
                  <SelectValue placeholder="Setor" />
                </SelectTrigger>
                <SelectContent>
                  {SETORES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={estado} onValueChange={setEstado}>
                <SelectTrigger>
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Cidade"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
              />
            </div>
            <Button 
              onClick={searchCompanies} 
              className="mt-4"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar Empresas
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {companies.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Resultados da Busca
              </CardTitle>
              <CardDescription>{companies.length} empresas encontradas</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Atividade</TableHead>
                    <TableHead>Localização</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company) => (
                    <TableRow key={company.cnpj}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{company.razao_social}</p>
                          <p className="text-sm text-muted-foreground">{company.nome_fantasia}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{company.cnpj}</TableCell>
                      <TableCell>
                        <div className="max-w-[200px]">
                          <p className="text-sm truncate" title={company.cnae_descricao}>
                            {company.cnae_descricao}
                          </p>
                          <p className="text-xs text-muted-foreground">{company.cnae_codigo}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3" />
                          {company.cidade}/{company.estado}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3" />
                            {company.telefone}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {company.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => importToLeads(company)}
                          disabled={importing === company.cnpj}
                        >
                          {importing === company.cnpj ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-1" />
                              Importar
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {companies.length === 0 && !loading && (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg mb-2">Pesquise Empresas</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Use os filtros acima para buscar empresas brasileiras. 
                Os dados são baseados em informações públicas do CNPJ.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
