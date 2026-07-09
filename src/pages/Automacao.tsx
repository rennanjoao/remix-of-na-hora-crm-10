import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlowManager } from '@/components/automacao/FlowManager';
import { BlastListsTab } from '@/components/automacao/BlastListsTab';
import { InboxTab } from '@/components/automacao/InboxTab';

export default function Automacao() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Automação de E-mails</h1>
          <p className="text-muted-foreground mt-1">
            Fluxos, disparos e respostas — tudo no editor visual de blocos.
          </p>
        </div>

        <Tabs defaultValue="flows">
          <TabsList>
            <TabsTrigger value="flows">Fluxos</TabsTrigger>
            <TabsTrigger value="blasts">Listas de Disparo</TabsTrigger>
            <TabsTrigger value="inbox">Caixa de Entrada</TabsTrigger>
          </TabsList>

          <TabsContent value="flows" className="mt-4">
            <FlowManager type="cadence" />
          </TabsContent>

          <TabsContent value="blasts" className="mt-4">
            <BlastListsTab />
          </TabsContent>

          <TabsContent value="inbox" className="mt-4">
            <InboxTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
