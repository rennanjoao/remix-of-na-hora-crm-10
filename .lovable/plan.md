
# Plano de Evolução — CRM orientado a Prospecção Ativa

## Princípio norteador
Uma única tela ("Foco do Dia") vira o lugar onde o SDR trabalha 90% do tempo. Todo o resto (Leads, Prospecção, Reuniões, Automação) passa a ser suporte, não destino diário.

## Diagnóstico rápido do que existe hoje
- 9 páginas no menu (Dashboard, Leads, Prospecção, Reuniões, Automação, Calendário, Command Center, Auditoria, Admin) → dispersão excessiva para o SDR.
- Componentes fortes já prontos e reutilizáveis: `LeadDetailPanel`, `LeadRichProfile`, `CNPJSearchCard`, `PlacesSearchMode`, `ReactivationList`, `LeadActivityTimeline`, `ScheduleMeetingModal`, `BulkEmailModal`, `BlockEditor`, `FlowManager`, `InboxTab`, kanban em `Leads.tsx`, `claim_next_lead()` RPC, tabelas `tasks`/`lead_activities`/`meetings`/`email_inbox`.
- `Prospeccao.tsx` já usa split-screen (histórico + painel do lead) — é o embrião da nova experiência.
- Falta: uma fila priorizada unificada que junte novos leads + follow-ups + respostas + tarefas + reuniões próximas.

## Nova arquitetura de navegação
Menu reduzido a 4 itens para SDR:

```text
1. Foco        (nova página — fila do dia, é a home do SDR)
2. Leads       (base completa, busca/kanban — consulta, não operação diária)
3. Prospecção  (gerar novos leads: CNPJ + Places + Mining)
4. Automação   (fluxos + inbox + listas)
```

Reuniões e Calendário deixam de ser páginas próprias e viram abas/drawer dentro de Foco. Command Center e Auditoria ficam só para admin/gerente. Dashboard some do menu do SDR (métricas vão para o header do Foco).

## Página "Foco do Dia" — o coração do produto

Layout em 3 colunas (reaproveita padrão split-screen atual):

```text
┌───────────────┬──────────────────────────┬──────────────┐
│ FILA (250px)  │ LEAD ATIVO (fluido)      │ AÇÕES (320) │
│               │                          │              │
│ [Agora] 12    │ Header: nome, cidade,    │ Ligar        │
│  • Lead A     │ CNAE, telefone, tags     │ WhatsApp     │
│  • Lead B     │                          │ E-mail       │
│               │ Tabs: Perfil │ Timeline  │ Agendar      │
│ [Hoje] 34     │        │ E-mails │ Tarefas│ Nota        │
│ [Atrasados] 8 │                          │ ─────        │
│ [Respostas] 3 │ LeadRichProfile          │ Próxima ação │
│ [Reuniões] 2  │ + LeadActivityTimeline   │ Descartar    │
└───────────────┴──────────────────────────┴──────────────┘
```

Regras da fila (ordenação por prioridade, calculada server-side):
1. Respostas recebidas (email_inbox não lido)
2. Reuniões nas próximas 2h
3. Tarefas atrasadas
4. Follow-ups do dia (lead_activities.next_action_at ≤ hoje)
5. Novos leads sem contato (status `novo`, sem timeline)
6. Reativação (`leads_para_reativar()` já existe)

Interações-chave:
- Teclado: `J/K` navega, `C` liga, `W` WhatsApp, `E` e-mail, `M` marca reunião, `N` nota, `D` descarta, `→` próximo. Zero mouse necessário.
- Ao concluir uma ação, o próximo item da fila carrega automaticamente (sem clique).
- "Ligar" abre `tel:`, registra `call_made` e abre um textarea de resultado inline (sem modal): "atendeu / não atendeu / caixa" + próxima data → cria task + timeline em uma submissão.
- "WhatsApp" reutiliza a lógica já em `Prospeccao.tsx` (wa.me + script interpolado).
- "E-mail" abre um popover com `BlockEditor` compacto ou dispara passo de fluxo com um clique.
- "Agendar" reutiliza `ScheduleMeetingModal` mas como drawer lateral, pré-preenchido.

## Reaproveitamento de componentes
| Componente atual                     | Novo uso                                    |
|--------------------------------------|---------------------------------------------|
| `LeadRichProfile`, `LeadDetailPanel` | Painel central do Foco                      |
| `LeadActivityTimeline`               | Aba Timeline do Foco                        |
| `ScheduleMeetingModal`               | Ação "Agendar" (vira drawer)                |
| `BlockEditor` + `FlowManager`        | Popover de e-mail rápido + gestão em Automação |
| `InboxTab`                           | Fonte da categoria "Respostas" na fila      |
| `ReactivationList`                   | Fonte da categoria "Reativação" na fila     |
| `CNPJSearchCard`, `PlacesSearchMode` | Continuam em `/prospeccao` (gerador de leads) |
| Kanban do `Leads.tsx`                | Mantido como visão alternativa em `/leads`  |
| RPC `claim_next_lead`                | Botão "Puxar novo lead" da fila             |

## Fluxos simplificados
- **Prospectar novo lead**: hoje = ir para Prospecção → buscar → importar → ir para Leads → abrir card → agir. Novo = na Foco, botão "Puxar lead" chama `claim_next_lead` e o lead já aparece no painel central pronto para ação.
- **Follow-up**: hoje = lembrar de olhar filtro/tarefa. Novo = aparece sozinho na fila no dia certo.
- **Resposta de e-mail**: hoje = abrir Automação → Inbox. Novo = topo da fila com destaque.
- **Agendar reunião**: hoje = modal em página separada. Novo = drawer inline sem sair do Foco.
- **Registrar ligação**: hoje = abrir card → escrever timeline → criar task. Novo = 1 formulário inline com resultado + próxima data.

## Telas que somem/consolidam
- `/dashboard` → removida do menu SDR (métricas viram header compacto do Foco: prospectados hoje, reuniões, respostas, taxa).
- `/reunioes` e `/calendario` → viram abas dentro do Foco (drawer "Minha agenda"). Rota mantida acessível para gerente.
- `Automacao` mantém 3 abas, mas Inbox agora é fonte da fila (menos motivo para abrir a página).
- Modais de e-mail em massa e importação continuam onde estão — não afetam o dia-a-dia do SDR.

## Automação que reduz esforço mental
- Após "não atendeu" 2×, sistema sugere trocar canal (WhatsApp/e-mail) automaticamente.
- Após e-mail enviado sem resposta em 3 dias, cria follow-up na fila.
- Resposta detectada em `email_inbox` → sobe para topo da fila do SDR dono.
- Reunião confirmada → cria task de preparo 1h antes.
- Lead sem atividade há 30 dias e não convertido → move para reativação.

Tudo isso já tem infraestrutura (tasks, lead_activities, email_inbox, cron `process-email-flows`); falta apenas: uma view SQL `sdr_work_queue` que una as fontes com score de prioridade, e um trigger/edge function pequena para as regras acima.

## Entregas priorizadas

**Fase 1 — Fundamento da Fila (maior impacto):**
1. View `sdr_work_queue` (SQL) unindo respostas, reuniões, tarefas, follow-ups, novos leads, reativação — com `priority_score` e `bucket`.
2. Página `/foco` com layout 3 colunas reutilizando `LeadRichProfile` + `LeadActivityTimeline`.
3. Menu reduzido a 4 itens; `/foco` vira a home pós-login para SDR.
4. Ações rápidas inline: ligar (resultado + próxima data), WhatsApp, nota, descartar, agendar (drawer).
5. Atalhos de teclado J/K/C/W/E/M/N/D.

**Fase 2 — Automações que empurram trabalho:**
6. Regras de próxima ação automática (canal alternado, follow-up pós e-mail, preparo pré-reunião).
7. Resposta em `email_inbox` sobe para o topo com badge visual.
8. E-mail rápido em popover dentro do Foco (reutiliza `BlockEditor`).

**Fase 3 — Polimento e volume:**
9. Densidade visual: badges de canal, último contato, próxima ação em cada card.
10. Busca global (⌘K) que abre qualquer lead no painel do Foco sem trocar de página.
11. Modo lista virtualizada em `/leads` para milhares de registros.
12. Métricas de dia no header do Foco (substituem `/dashboard` para SDR).

## Mudanças com maior impacto na produtividade
1. **Fila unificada** — elimina a decisão "o que faço agora?".
2. **Ações inline sem modal** — corta 3–5 cliques por lead.
3. **Atalhos de teclado** — permite ritmo de 60–100 leads/dia sem cansaço.
4. **Auto-advance após ação** — remove tempo morto entre leads.
5. **Menu de 4 itens** — reduz carga cognitiva.

## Confirmação antes de codar
Antes de implementar, preciso do seu OK em três pontos:
- (a) Aceita reduzir o menu do SDR a 4 itens e transformar `/foco` na home pós-login?
- (b) Fase 1 sozinha primeiro (valida a Fila com dados reais) ou Fases 1+2 juntas?
- (c) Manter `/reunioes` e `/calendario` acessíveis por URL direta (só saem do menu) — confirma?
