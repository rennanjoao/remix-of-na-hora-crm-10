# Auditoria + plano de evolução — CRM Na Hora Transporte

## 1. Auditoria (estado atual)

Base auditada: 13 páginas, ~30 componentes, 15 edge functions, 20 tabelas, 11 funções de banco, 81 leads / 93 atividades em produção.

### Já funcionando (preservar)
- Auth + RBAC (`user_roles`, `has_role`, `get_profile_id`), rotas protegidas fail-closed.
- Fila "Foco" (`sdr_work_queue`), Kanban de leads, timeline de atividades, reuniões/calendário.
- Prospecção: Google Places, CNPJ (BrasilAPI + fallback ReceitaWS com cache 30d), scraping de e-mail, score ICP, buscas salvas, import CSV.
- E-mail: domínio Resend, fluxos em blocos, processador via pg_cron, tracking, bounce/supressão, inbox.
- TypeScript strict ligado, zero `any`, CORS restrito, JWT validado nas edge functions.

### Problemas encontrados
| # | Severidade | Problema |
|---|---|---|
| 1 | Crítico | Não existe fila de jobs. Enriquecimento (CNPJ/Places) roda no navegador, 1 lead por vez. 200 leads/dia é inviável. |
| 2 | Crítico | Sem retry/backoff nem circuit breaker para APIs externas: falha da BrasilAPI/Google derruba a importação em vez de deixar o lead `pendente`. |
| 3 | Crítico | Modelo achatado: tudo é `leads`. Sem empresa, sem múltiplos contatos, sem oportunidade, sem valor — impossível responder pipeline financeiro. |
| 4 | Alto | "Próxima ação" só existe como `leads.next_contact_date` (data, sem hora/tipo/responsável). Leads ativos ficam sem próximo passo. |
| 5 | Alto | Índices ausentes em `tasks` (só PK), `meetings.lead_id`/`meeting_date`, `leads(assigned_to,status)`, `leads.email`. `sdr_work_queue` faz 6 UNIONs sem suporte de índice. |
| 6 | Alto | Kanban com paginação global de 50 — leads antigos somem de colunas avançadas; busca ainda parcialmente client-side. |
| 7 | Alto | `email_sends` sem chave de idempotência (lead+flow+step): reprocessamento pode duplicar envio. |
| 8 | Médio | Provider de e-mail acoplado: lógica Resend dentro de `send-email`. Sem controle de quota por provider (só limite diário por domínio). |
| 9 | Médio | Sem feature flags nem modo mock — não dá para testar carga sem gastar quota, nem desligar uma integração instável. |
| 10 | Médio | `api_usage_logs` quase não é alimentada; não há tela de saúde de APIs. |
| 11 | Médio | Dedup de importação cobre CNPJ/telefone; falta domínio, e-mail e nome+cidade normalizados; sem preview de "criar/atualizar/ignorar". |
| 12 | Médio | Cadência é só e-mail. Não gera tarefas para ligação/WhatsApp/LinkedIn; parada automática ao responder não está garantida em todos os gatilhos. |
| 13 | Baixo | Motivo de perda é texto livre no modal; falta taxonomia fixa para análise. |
| 14 | Baixo | Métricas de gestão (conversão por etapa, tempo por etapa, no-show, por cidade/segmento/origem) inexistentes. |

## 2. Decisões de arquitetura

- **Evolução, não reescrita.** `leads` continua sendo a entidade "empresa" (renomear seria destrutivo). Ganha campos de empresa (domínio, porte, funcionários, faturamento estimado, icp_score) e passa a ser pai de `lead_contacts` e `opportunities`.
- **Funil em duas camadas:** `leads.status` (prospecção) + `opportunities.stage` (comercial). Enum atual preservado e estendido — nada é apagado.
- **Fila no Postgres:** tabela `jobs` + pg_cron chamando um worker edge function com lote limitado, lock de execução única, retry 30s/2min/10min e circuit breaker por provider.
- **Providers atrás de interface:** `EmailProvider`, `CnpjProvider`, `PlacesProvider`, `GeocodingProvider`, `WhatsAppProvider`, cada um com implementação real + mock, escolhidos por feature flag no banco.

## 3. Execução por blocos (build + tipos + testes ao fim de cada bloco)

**Bloco P0 — fundação e performance**
- Índices faltantes (`tasks`, `meetings`, `leads` compostos, `email_sends` idempotência única).
- Tabela `jobs` + worker + pg_cron + retry/backoff + `provider_health`.
- Tabela `feature_flags` e `provider_quota`; modo mock por flag.
- Kanban: contagem por coluna e paginação independente, busca 100% server-side com CNPJ/telefone normalizados.

**Bloco P1 — modelo comercial**
- `lead_contacts` (vários contatos por empresa, cargo, tipo, decisor) migrando `nome_decisor`.
- `opportunities` (valor, valor mensal, probabilidade, previsão, dados da operação logística, motivo de perda) + pipeline board.
- `next_action_at`/`next_action_type`/`next_action_owner` em leads e oportunidades, com alertas atrasado/hoje/próximo/sem ação.
- Score ICP no banco (função + recálculo por job), classificação A/B/C.
- Timeline unificada empresa → contatos → oportunidades → atividades.

**Bloco P2 — produtividade do SDR**
- Dashboard SDR operacional: metas, atividades do dia, atrasados, leads quentes (responderam, reunião pendente, follow-up atrasado).
- Formulário de qualificação que gera oportunidade.
- Taxonomia fixa de motivos de perda.

**Bloco P3 — automação multicanal**
- Motor de cadência com passos por canal (e-mail automático; ligação/WhatsApp/LinkedIn geram tarefa).
- Parada automática em resposta, reunião, oportunidade, opt-out ou "sem interesse".
- Fila de e-mail idempotente + quota por provider (envio fica `QUEUED` em vez de falhar).
- `WhatsAppProvider` com fallback manual (link wa.me) registrando a atividade.

**Bloco P4 — gestão**
- Views/RPCs de conversão por etapa, tempo por etapa, reunião agendada/realizada/no-show, pipeline total e ponderado.
- Performance por SDR, origem, segmento e cidade, com filtro de período.
- Tela de saúde de APIs (uso, quota, erros, última chamada).

**Validação de carga**
- Script de seed em modo mock: 200 / 1.000 / 5.000 leads passando por import → dedup → fila → enriquecimento → score → distribuição, medindo tempo e fila residual.

## 4. Segurança (aplicado em todos os blocos)
- Toda tabela nova: GRANT explícito + RLS (SDR vê o que é dele, gerente vê a equipe, admin vê tudo).
- Nenhum `sdr_id` vindo do frontend é confiável — sempre resolvido do JWT no backend.
- Jobs e workers só via service role, protegidos por `CRON_SECRET`.

## 5. Pendências que dependem de você
- Provider de WhatsApp (Evolution API ou outro) — arquitetura fica pronta, credenciais depois.
- Metas por SDR (números) e faixas de faturamento/porte do ICP.
- Confirmar se quer manter Resend ou avaliar Brevo como provider alternativo.

Sugestão: aprovar e começar pelo Bloco P0, que é o que destrava os 200 leads/dia.
