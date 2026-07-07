# Refatoração do módulo de prospecção — 8 etapas

Antes de começar, preciso **confirmar 3 pontos bloqueantes** (principalmente Etapa 4) para não travar no meio da implementação.

---

## Perguntas bloqueantes

### 1. Google Meet real (Etapa 4) — como autenticar?

Criar Meet real pela Google Calendar API **não é gratuito de configurar** — exige credenciais. Duas opções:

- **A) OAuth refresh token do Felipe (recomendado, mais simples):** você precisa criar um projeto no Google Cloud Console, habilitar Calendar API, criar OAuth Client ID (Web), rodar uma vez o fluxo de consent com a conta do Felipe e me passar o `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` e `GOOGLE_OAUTH_REFRESH_TOKEN` como secrets. Todo evento é criado no calendário do Felipe.
- **B) Service Account com Domain-Wide Delegation:** exige Google Workspace (pago) e admin do domínio. Só faz sentido se vocês já tiverem Workspace.
- **C) Conector Google Calendar da Lovable:** já disponível, mas ele acessa o calendário do **dono da conexão** (você), não do Felipe — pode ou não servir dependendo de quem organiza as reuniões.

**Confirma qual caminho?** Se A, posso deixar a edge function pronta e você me passa os secrets depois; enquanto isso o botão "Agendar" fica em modo Jitsi (fallback) para não quebrar.

### 2. Etapa 5 — trigger de banco ou frontend?

Você deu as duas opções. **Recomendo frontend** (chamar `enrollLeadInCampaign()` logo depois do UPDATE do `contact_outcome`), porque:
- trigger de banco precisaria ler `email_campaigns`/`email_steps` e agendar `email_sends` com `scheduled_at = now + delay_days` — dá pra fazer, mas fica opaco pra debug;
- frontend reusa a lógica já existente em `Automacao.tsx` e é fácil de testar.

Confirma **frontend**? (se preferir trigger, faço).

### 3. Etapa 7 — scrape de site

Fetch direto de site externo funciona em edge function (sem CORS), mas alguns sites (Cloudflare, bot-protection) devolvem 403. Aceita que nesses casos a função apenas retorne `emails: []` sem erro, e o card mostre "não foi possível extrair automaticamente"? (alternativa paga seria Firecrawl).

---

## Plano de implementação (após respostas)

### Etapa 1 — Migration SQL
Nova migration com o enum `contact_outcome`, 4 colunas em `leads`, e a função `leads_para_reativar()`. GRANTs preservados. `loss_reason` mantido.

### Etapa 2 — Refatorar `PlacesSearchMode.tsx`
Trocar `LOSS_REASONS` por `CONTACT_OUTCOMES` (6 opções), cada uma com um handler que calcula `next_contact_date`, `status`, `is_suppressed` e chama UPDATE. Se lead ainda não importado, importa antes.

### Etapa 3 — Importação em lote
Botão "Importar todos os visíveis (N)" acima da lista. Roda `handleImport` em `Promise.all` com estado `{ current, total }` mostrando "Importando X de Y…". Skipa os que já estão em `importedIds`.

### Etapa 4 — Edge function `schedule-meeting`
- Novo arquivo `supabase/functions/schedule-meeting/index.ts` seguindo padrão de `places-enrich`.
- Renomeia `meetings.jitsi_link` para `meeting_link` via migration ALTER (mantendo dados antigos: `ALTER … RENAME COLUMN`).
- Chama Google Calendar API `events.insert` com `conferenceDataVersion=1` e `conferenceData.createRequest` → devolve `hangoutLink`.
- Fallback Jitsi se secrets Google ausentes.
- Novo modal `ScheduleMeetingWithOutcomeModal` (reusa o `ScheduleMeetingModal` existente se possível), aberto automaticamente quando outcome = `decisor_apresentado`.

### Etapa 5 — Enrollment em cadência
Nova função utilitária `enrollLeadInCampaign(leadId, campaignSlug)` em `src/lib/campaign-enroll.ts`. Lê `email_campaigns` por slug, lê `email_steps`, insere N rows em `email_sends` com `scheduled_at` computado. Verifica duplicidade (`WHERE lead_id=… AND campaign_id=… AND status IN ('pending','sent')`). Chamada dentro do handler da Etapa 2 para os outcomes `pediu_apresentacao` (slug `apresentacao-institucional`) e `sem_resposta` (slug `recaptura-pos-silencio`).

**Nota:** vou precisar checar se `email_campaigns` tem coluna `slug` (senão, adiciono via migration nesta etapa) e se as duas campanhas já existem (senão, alerto e não crio automaticamente).

### Etapa 6 — Card de reativação no Dashboard
Adicionar 4º card no grid do `ProspeccaoDashboard.tsx` (grid vira `md:grid-cols-4`). Chama `supabase.rpc('leads_para_reativar')` e mostra top 5 com botão "Reabrir contato" que:
- UPDATE `leads` set `status='novo'`, `is_suppressed=false`, `next_contact_date=null`
- INSERT em `lead_timeline` com o outcome anterior preservado (`event_type='reactivation'`, `metadata: { previous_outcome, previous_loss_reason }`)

### Etapa 7 — Edge function `site-email-scrape`
- Fetch da home + `/contato` (2 tentativas paralelas, timeout 5s cada).
- Regex `mailto:` (confidence=high) e `[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}` (medium), filtrando lixo (`example.com`, `sentry.io`, `wixpress.com`).
- Cache em `sessionStorage` por website URL no frontend.
- Chamada automática no `useEffect` do card com `item.website`, mostrando pill "e-mail encontrado" com botão copiar + input editável.

### Etapa 8 — WhatsApp personalizado + timeline
- Nova função `buildWhatsAppMessage(item)` usando template com `item.category` e `item.city`.
- Após `window.open(...)`, insert em `lead_timeline` com `contact_type='whatsapp'`, `event_type='outbound_attempt'`.

---

## Ordem de execução

Faço 1 → 3 → 5 → 6 → 7 → 8 → 2 → 4, porque a Etapa 2 depende do enrollment (Etapa 5) e do modal de agendamento (Etapa 4). Cada etapa vai num turno separado com verificação (build, spot-check via edge function curl).

**Aguardo as respostas às 3 perguntas para começar pela Etapa 1.**
