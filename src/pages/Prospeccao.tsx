import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Building2, Search, Pickaxe } from 'lucide-react';

import { useBrasilAPI } from '@/hooks/useBrasilAPI';
import { CNPJSearchCard } from '@/components/prospeccao/CNPJSearchCard';
import { LeadDetailPanel } from '@/components/prospeccao/LeadDetailPanel';
import { ConsultaHistoryTable } from '@/components/prospeccao/ConsultaHistoryTable';
import { MiningMode } from '@/components/prospeccao/MiningMode';
import { ProspeccaoStatusBar } from '@/components/prospeccao/ProspeccaoStatusBar';

interface Consulta {
  id: string;
  cnpj: string;
  razao_social: string | null;
  cnae_codigo: string | null;
  cidade: string | null;
  estado: string | null;
  importado: boolean | null;
  created_at: string;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, '').slice(-11);
}

export default function Prospeccao() {
  const { isAllowed, loading: guardLoading } = useRoleGuard(['admin', 'sdr'], '/dashboard');
  const { profile } = useAuth();
  const { searchCNPJ, company, loading, reset } = useBrasilAPI();

  const [importing, setImporting] = useState(false);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [consultadasHoje, setConsultadasHoje] = useState(0);
  const [importadasHoje, setImportadasHoje] = useState(0);
  const [emailsHoje, setEmailsHoje] = useState(0);

  const loadConsultas = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('cnpj_consultas')
      .select('id, cnpj, razao_social, cnae_codigo, cidade, estado, importado, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setConsultas(data);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ count: countHoje }, { count: countImportadas }, { count: countEmails }] = await Promise.all([
      supabase.from('cnpj_consultas').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      supabase.from('cnpj_consultas').select('id', { count: 'exact', head: true }).eq('importado', true).gte('created_at', today.toISOString()),
      supabase.from('email_sends').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
    ]);
    setConsultadasHoje(countHoje || 0);
    setImportadasHoje(countImportadas || 0);
    setEmailsHoje(countEmails || 0);
  }, [profile]);

  useEffect(() => {
    if (profile) loadConsultas();
  }, [profile, loadConsultas]);

  const handleSearch = async (cnpj: string) => {
    if (!profile) return;
    reset();
    setAlreadyImported(false);

    const existing = consultas.find(c => c.cnpj === cnpj);
    if (existing?.importado) setAlreadyImported(true);

    const result = await searchCNPJ(cnpj);
    if (!result) return;

    await supabase.from('cnpj_consultas').insert([{
      cnpj,
      razao_social: result.razao_social,
      nome_fantasia: result.nome_fantasia,
      cnae_codigo: String(result.cnae_fiscal),
      cnae_descricao: result.cnae_fiscal_descricao,
      logradouro: `${result.logradouro}${result.numero ? ', ' + result.numero : ''}`,
      cidade: result.municipio,
      estado: result.uf,
      telefone: normalizePhone(result.ddd_telefone_1 || result.ddd_telefone_2),
      email: result.email,
      dados_completos: JSON.parse(JSON.stringify(result)),
      consultado_por: profile.id,
    }]);

    const { data: existingLead } = await supabase.from('leads').select('id').eq('cnpj', cnpj).maybeSingle();
    if (existingLead) setAlreadyImported(true);

    loadConsultas();
  };

  const handleImport = async () => {
    if (!profile || !company) return;
    setImporting(true);
    try {
      const cnpjClean = company.cnpj.replace(/\D/g, '');
      // Dedup: CNPJ > phone > name+city
      const phoneNorm = normalizePhone(company.ddd_telefone_1 || company.ddd_telefone_2);

      const { data: byCNPJ } = await supabase.from('leads').select('id').eq('cnpj', cnpjClean).maybeSingle();
      if (byCNPJ) { toast.error('Esta empresa já está cadastrada como lead'); setAlreadyImported(true); return; }

      if (phoneNorm) {
        const { data: byPhone } = await supabase.from('leads').select('id').eq('telefone', phoneNorm).maybeSingle();
        if (byPhone) { toast.error('Lead com este telefone já existe'); setAlreadyImported(true); return; }
      }

      const { data: newLead, error } = await supabase.from('leads').insert({
        cnpj: cnpjClean,
        razao_social: company.razao_social,
        nome_fantasia: company.nome_fantasia,
        telefone: phoneNorm,
        email: company.email,
        cidade: company.municipio,
        estado: company.uf,
        cnae_codigo: String(company.cnae_fiscal),
        cnae_descricao: company.cnae_fiscal_descricao,
        setor: company.cnae_fiscal_descricao,
        created_by: profile.id,
        assigned_to: profile.id,
        status: 'novo',
        fonte: 'Brasil API',
      }).select('id').single();

      if (error) throw error;

      await supabase.from('cnpj_consultas').update({ importado: true, lead_id: newLead.id }).eq('cnpj', cnpjClean).eq('consultado_por', profile.id);
      toast.success('Empresa importada para o CRM!');
      setAlreadyImported(true);
      loadConsultas();
    } catch (err) {
      console.error('Error importing lead:', err);
      toast.error('Erro ao importar empresa');
    } finally {
      setImporting(false);
    }
  };

  const handleStartEmailFlow = () => toast.info('Acesse a aba Automação para configurar o fluxo de boas-vindas');

  const handleSendWhatsApp = () => {
    if (!company) return;
    const phone = normalizePhone(company.ddd_telefone_1 || company.ddd_telefone_2);
    if (!phone) return;
    const msg = encodeURIComponent(`Olá! Somos especializados em soluções de transporte e logística. Gostaríamos de apresentar nossos serviços para a ${company.nome_fantasia || company.razao_social}.`);
    window.open(`https://wa.me/55${phone}?text=${msg}`, '_blank');
    toast.success('WhatsApp aberto em nova aba');
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

  if (!isAllowed) return null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold">Prospecção B2B</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Consulte dados oficiais da Receita Federal e importe leads qualificados
            </p>
          </div>
        </div>

        <ProspeccaoStatusBar
          consultadasHoje={consultadasHoje}
          importadasHoje={importadasHoje}
          emailsHoje={emailsHoje}
        />

        <Tabs defaultValue="consulta" className="space-y-4">
          <TabsList>
            <TabsTrigger value="consulta" className="gap-2">
              <Search className="h-4 w-4" />
              Consulta Individual
            </TabsTrigger>
            <TabsTrigger value="mineracao" className="gap-2">
              <Pickaxe className="h-4 w-4" />
              Modo Mineração
            </TabsTrigger>
          </TabsList>

          <TabsContent value="consulta" className="space-y-4">
            <CNPJSearchCard onSearch={handleSearch} loading={loading} />

            {/* Split-screen for individual search */}
            {company ? (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-5 w-5" />
                      Histórico de Consultas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ConsultaHistoryTable consultas={consultas} />
                  </CardContent>
                </Card>

                <div className="lg:sticky lg:top-4">
                  <Card className="overflow-hidden">
                    <LeadDetailPanel
                      company={company}
                      onImport={handleImport}
                      importing={importing}
                      alreadyImported={alreadyImported}
                      onStartEmailFlow={alreadyImported ? handleStartEmailFlow : undefined}
                      onSendWhatsApp={alreadyImported ? handleSendWhatsApp : undefined}
                    />
                  </Card>
                </div>
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-5 w-5" />
                    Histórico de Consultas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ConsultaHistoryTable consultas={consultas} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="mineracao">
            <MiningMode />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
