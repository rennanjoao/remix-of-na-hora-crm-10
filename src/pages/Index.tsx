import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Truck, ArrowRight, BarChart3, Users, Calendar, Shield, Loader2 } from 'lucide-react';

export default function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user && !loading) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const features = [
    { icon: BarChart3, title: 'Dashboard Inteligente', description: 'Métricas em tempo real para decisões estratégicas' },
    { icon: Users, title: 'Gestão de Leads', description: 'Pipeline completo do primeiro contato ao fechamento' },
    { icon: Calendar, title: 'Calendário Integrado', description: 'Agende reuniões e acompanhe follow-ups' },
    { icon: Shield, title: 'Controle de Acesso', description: 'Segurança por cargo: Admin, SDR, Gerente, Motorista' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZTJlOGYwIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="text-center">
            <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-primary mb-8 shadow-lg">
              <Truck className="h-10 w-10 text-primary-foreground" />
            </div>
            
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground tracking-tight">
              Na Hora Transporte
            </h1>
            <p className="mt-4 text-xl sm:text-2xl text-muted-foreground font-medium">
              CRM Logístico Inteligente
            </p>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground">
              Gerencie leads, prospecte empresas brasileiras e acompanhe sua equipe comercial 
              com um sistema seguro e adaptativo ao cargo de cada usuário.
            </p>
            
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button 
                size="lg" 
                onClick={() => navigate('/auth')}
                className="text-lg px-8"
              >
                Começar Agora
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl font-bold text-foreground">
              Tudo que você precisa para vender mais
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Ferramentas poderosas para sua equipe comercial
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div 
                key={index}
                className="bg-card rounded-xl p-6 border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-lg bg-primary/10 mb-4">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-display text-3xl font-bold text-foreground mb-6">
            Pronto para transformar suas vendas?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Cadastre-se gratuitamente e comece a gerenciar seus leads hoje mesmo.
          </p>
          <Button 
            size="lg" 
            onClick={() => navigate('/auth')}
            className="text-lg px-8"
          >
            Criar Conta Gratuita
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <span className="font-display font-semibold">Na Hora Transporte</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 Na Hora Transporte. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
