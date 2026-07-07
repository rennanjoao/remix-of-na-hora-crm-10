# Plano — Correções de Arquitetura, RBAC e Prospecção

Este é um trabalho grande (6 fases, várias migrations + refactor de front). Proponho executar **fase por fase**, confirmando cada uma antes de prosseguir, exatamente como o próprio prompt sugere. Isso evita corromper dados de produção e permite validar cada etapa no preview.

## Fase 1 — Segurança de rotas + `is_active` em `has_role` (crítico)
- Novo `src/components/ProtectedRoute.tsx`.
- Envolver rotas em `src/App.tsx` com `ProtectedRoute` usando os arrays de `navItems`.
- Migration: recriar `public.has_role()` com JOIN em `profiles.is_active = true`.
- Verificar que nenhuma policy quebra (todas usam `has_role`).

## Fase 2 — Chamada instantânea por lead + fix do `lead_id` fake
- Em `Leads.tsx`: `startInstantCallForLead(lead)`, botão `Zap` na linha, iframe Jitsi inline.
- Em `Reunioes.tsx`: remover fallback `leads[0]?.id || profile.id`; desabilitar botão "Iniciar Agora" sem lead selecionado (até Fase 4 tornar `lead_id` nullable).

## Fase 3 — Tela "Fila de Follow-up" (landing do SDR)
- Migration: `leads.next_follow_up_at`, `last_contact_at` + índice parcial.
- Nova página `src/pages/FollowUp.tsx` com 3 seções (Atrasados / Hoje / Próximos).
- Ações inline: Ligar Agora, WhatsApp, Adiar, Marcar contato feito.
- Rota `/follow-up` + item no sidebar (antes de "Leads").
- Redirect pós-login: SDR → `/follow-up`, admin/gerente → `/dashboard`.

## Fase 4 — Concorrência entre SDRs
- Migration: `claim_lead()`, tabela `lead_locks` (+ RLS), `round_robin_state` + trigger `assign_round_robin`, índice único parcial em `leads.cnpj`, `meetings.lead_id` nullable com `ON DELETE SET NULL`.
- `MiningMode.tsx`: `upsert` com `onConflict: 'cnpj'`.
- `Leads.tsx`: checar/criar/renovar/deletar lock ao abrir "Detalhes"; usar `rpc('claim_lead')` para leads sem dono.

## Fase 5 — Log automático de status + dashboards separados
- Migration: `lead_status_history` + trigger + policies + views `funnel_by_sdr` e `conversion_by_source`.
- Refactor `Dashboard.tsx` → roteador entre `SDRDashboard.tsx` (métricas pessoais) e `LeadershipDashboard.tsx` (agregados; drill-down via query params para `Leads.tsx`).

## Fase 6 (opcional) — Duração real via Jitsi IFrame API
- Migration: `call_sessions` + RLS.
- Substituir `<iframe>` cru por `JitsiMeetExternalAPI`, registrando `videoConferenceJoined`/`Left` para gravar duração real.

## Detalhes técnicos
- Migrations novas apenas (nunca editar as já aplicadas).
- Regenerar `types.ts` após cada migration.
- Nenhuma RLS existente será removida — apenas complementada.
- Validação ao fim de cada fase: abrir `Leads`, `Reunioes`, `Dashboard` sem erro no console.

## Como quer prosseguir?
Recomendo começar **agora pela Fase 1** (é o buraco de segurança ativo) e, ao terminar, eu paro e aguardo seu OK para a Fase 2. Se preferir, posso emendar Fase 1 + Fase 2 direto, ou executar tudo até a Fase 5 (Fase 6 é opcional) sem parar. Diga qual ritmo prefere.
