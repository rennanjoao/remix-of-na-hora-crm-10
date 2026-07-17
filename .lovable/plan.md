# Plano — Prospecção & Leads cirúrgicos

Antes de tocar em código, confirmo o mapeamento do que **já existe** no projeto (verifiquei nesta análise, para você não pagar por reimplementação):

**Já existe — NÃO recriar:**
- `cnpj-enrich` (edge) + `useBrasilAPI` (hook) — enriquecimento CNPJ.
- `ScriptsManager` — gestor de scripts.
- `verify-email-mx` + `verify-email-domain` — verificação de domínio/MX.
- `email_domains` table + `EmailDomainManager`.
- Supressão manual: coluna `leads.is_suppressed`, `suppressed_emails`, `handle-unsubscribe`.
- Dashboard com funil Recharts (`Dashboard.tsx`).
- Componente `command.tsx` do shadcn (instalado, disponível para Cmd+K).
- Deduplicação na importação (CNPJ/telefone/place_id).
- Exportação CSV em `Leads.tsx` (`toCSV`/`downloadCSV`).
- `Prospeccao.tsx` já usa React.lazy nas rotas (via `App.tsx`) — verificar.

**Não existe hoje — vai ser criado:**
- Limite diário por domínio remetente.
- Auto-enriquecimento CNPJ ao importar do Places.
- Bounce → supressão automática.
- Score ICP no card do Places.
- Buscas salvas.
- Import CSV.
- Cmd+K global, atalhos no detalhe, modo compacto, filtros sticky.
- Merge de duplicatas em Admin.
- Métricas de bounce/resposta/MX no Dashboard.

---

## Fases (mesma ordem que você pediu, validando build entre elas)

### Fase 1 — Proteção da operação (baixo risco visual)
1. **Migração DB**: índices em `leads(website)`, `leads(is_suppressed)`, `leads(place_id)`; adicionar `email_domains.daily_limit int default 500`, `daily_send_count int default 0`, `daily_count_reset_date date`.
2. **`send-email`**: antes do envio, incrementar `daily_send_count` do domínio ativo (resetando se `daily_count_reset_date` < hoje). Se estourar `daily_limit`, marcar send como `rate_limited` e não chamar Resend — o cron `process-email-flows` reagenda no dia seguinte.
3. **Bounce automático**: nova edge `resend-webhook` (verify_jwt=false, valida signing secret Resend) que trata `email.bounced` (hard) e `email.complained` → insere em `suppressed_emails` e marca `leads.is_suppressed=true` pelo `to_email`. Instruir você a configurar o webhook no painel do Resend (uma URL só).
4. **Auto-enriquecimento CNPJ no import Places**: em `PlacesSearchMode.insertLeadFromPlace`, se sem CNPJ, disparar `supabase.functions.invoke('cnpj-enrich', …)` em `void`/background e atualizar o lead ao retornar. Não bloqueia a UI.

### Fase 2 — Cirúrgico visível
5. **Score ICP** (`src/lib/icp-score.ts`, puro): combina rating*20 + log(reviews) + confiança de e-mail (alta=30/média=15/manual=5) + match de setor (termo pesquisado ⊂ types). Badge discreto no card + opção "Ordenar por fit" em `PlacesSearchMode`.
6. **Indicador de e-mail em andamento**: um `<span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />` ao lado do nome enquanto `enrichment.status==='loading'` naquele card específico. Sem skeleton, sem badge.

### Fase 3 — Escala de captação
7. **Buscas salvas**: tabela `saved_searches(id, sdr_id, name, query, zone, email_filter, created_at)` com RLS por `sdr_id`. Dropdown "Buscas salvas" no header do `PlacesSearchMode` + botão "Salvar busca atual".
8. **Import CSV de leads**: botão "Importar CSV" em `Leads.tsx`, usa `papaparse` (já leve, ~45kB), modal com mapeamento de colunas → insere em batch com dedup por CNPJ/telefone/e-mail.

### Fase 4 — Produtividade SDR
9. **Cmd+K global**: componente `<CommandPalette/>` montado em `DashboardLayout`, listener global de `⌘/Ctrl+K`. Busca lead por nome/CNPJ (server-side, top 8), navega para colunas do funil, abre Prospecção com foco na busca.
10. **Atalhos no detalhe do lead**: `L` liga (`tel:`), `W` WhatsApp, `1..6` muda status, `Esc` fecha. Só ativos quando modal está aberto e nenhum input focado.
11. **Modo compacto**: toggle no header da Prospecção e Leads salvo em `localStorage.density`. Aplica `data-density="compact"` em wrapper e reduz padding/font via classes condicionais.
12. **Filtros sticky**: `sticky top-0 z-10 bg-background/95 backdrop-blur border-b` na barra de filtros de Prospecção e Leads.
13. **Estados vazios acionáveis**: revisar `Nenhum resultado`/`Vazio` — trocar texto por próximo passo específico.

### Fase 5 — Consolidação
14. **Code-splitting**: adicionar em `vite.config.ts` `build.rollupOptions.output.manualChunks` separando `recharts`, `@dnd-kit/*`, `@tiptap/*`. Confirmar `React.lazy` em `Dashboard`/`Automacao`.
15. **Métricas de disparo no Dashboard**: nova aba/card com bounce rate (`suppressed_emails` criados no período ÷ enviados), taxa de resposta (`email_inbox` com `lead_id` ÷ enviados), % domínios reprovados MX.
16. **Merge de duplicatas em Admin**: view SQL `duplicate_lead_candidates` (pares com mesmo CNPJ / telefone normalizado / domínio de e-mail). Tela em `Admin.tsx` lista pares → botão "Mesclar" (mantém mais antigo, migra timeline/activities/meetings/tasks para o vencedor, marca perdedor `is_suppressed=true` com nota).

---

## Detalhes técnicos importantes

- **Rate limit atômico**: usar `UPDATE email_domains SET daily_send_count = CASE WHEN daily_count_reset_date < CURRENT_DATE THEN 1 ELSE daily_send_count+1 END, daily_count_reset_date = CURRENT_DATE WHERE id=? AND (daily_count_reset_date < CURRENT_DATE OR daily_send_count < daily_limit) RETURNING daily_send_count` — se não retornar linha, está no limite.
- **Resend webhook**: requer secret novo `RESEND_WEBHOOK_SECRET` — pedirei via `add_secret` antes de codar a Fase 1.3.
- **CSV**: usar `papaparse` (adicionar dep), streaming para arquivos grandes.
- **Score ICP**: função pura + teste em `__tests__/icp-score.test.ts`.
- **Merge de leads**: transação SQL como função `merge_leads(winner uuid, loser uuid)` SECURITY DEFINER restrita a admin — evita FK órfãs.
- **Cmd+K**: reusa `Command` do shadcn (já instalado), sem lib nova.

## Perguntas rápidas antes de começar

1. **Fase 1 é para eu executar já sozinha** (proteção operacional) ou você quer **Fases 1+2 juntas** (proteção + score ICP visível)?
2. **Resend webhook**: você já tem/quer criar o signing secret no painel do Resend? Se sim, posso pedir `RESEND_WEBHOOK_SECRET` via secret e você cola quando aplicar a Fase 1.
3. **Limite diário padrão** por domínio: começo em **500/dia** (aquecimento conservador) ou você prefere outro número?
4. **Merge de duplicatas**: mescla automática do "vencedor = mais antigo" está ok, ou você quer escolher manualmente na tela qual dos dois mantém?
