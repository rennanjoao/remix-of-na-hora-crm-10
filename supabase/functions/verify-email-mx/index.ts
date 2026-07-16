// Checks whether the domain of each given e-mail address has a mail server
// capable of receiving mail (MX record, falling back to an A/AAAA record per
// RFC 5321's implicit-MX rule). This is a deliverability *gate*, not a full
// SMTP/RCPT verification — Deno edge functions don't have raw TCP access to
// port 25 in this environment, so we can't do a live mailbox handshake. MX
// presence still filters out typos, dead domains, and placeholder addresses
// before they burn sender reputation on a bulk send.

import { buildCorsHeaders, requireAuthenticatedUser } from "../_shared/cors.ts";

const MAX_DOMAINS = 200;
const domainCache = new Map<string, boolean>();

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) return null;
  return domain;
}

async function hasMailServer(domain: string): Promise<boolean> {
  if (domainCache.has(domain)) return domainCache.get(domain)!;
  let ok = false;
  try {
    const mx = await Deno.resolveDns(domain, "MX");
    ok = Array.isArray(mx) && mx.length > 0;
  } catch {
    ok = false;
  }
  if (!ok) {
    // Implicit MX fallback (RFC 5321 §5.1): if there's no MX record but the
    // domain itself resolves, mail could still be deliverable to the host.
    try {
      const a = await Deno.resolveDns(domain, "A");
      ok = Array.isArray(a) && a.length > 0;
    } catch { /* keep false */ }
  }
  domainCache.set(domain, ok);
  return ok;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;

  try {
    const { emails } = await req.json();
    if (!Array.isArray(emails)) {
      return new Response(JSON.stringify({ error: "emails must be an array" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const domains = new Set<string>();
    for (const e of emails) {
      if (typeof e !== "string") continue;
      const d = extractDomain(e);
      if (d) domains.add(d);
      if (domains.size >= MAX_DOMAINS) break;
    }

    const entries = await Promise.all(
      [...domains].map(async (d) => [d, await hasMailServer(d)] as const),
    );
    const results: Record<string, boolean> = Object.fromEntries(entries);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("verify-email-mx error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
