import { buildCorsHeaders, requireAuthenticatedUser } from "../_shared/cors.ts";


const BLOCKLIST = [
  "example.com", "sentry.io", "sentry-next.wixpress.com", "wixpress.com",
  "wix.com", "godaddy.com", "cloudflare.com", "google-analytics.com",
  "googletagmanager.com", "facebook.com", "instagram.com", "sentry.wixpress.com",
];

const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)$/i;

function normalize(email: string): string {
  return email.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
}

function isValid(email: string): boolean {
  const e = normalize(email);
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return false;
  if (IMG_EXT.test(e)) return false;
  const domain = e.split("@")[1];
  return !BLOCKLIST.some(b => domain === b || domain.endsWith("." + b));
}

// ---- Proteção contra SSRF ----
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}
function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (a: string, mask: number) => {
    const base = ipv4ToInt(a)!;
    const m = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    return (n & m) === (base & m);
  };
  return (
    inRange("10.0.0.0", 8) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.168.0.0", 16) ||
    inRange("127.0.0.0", 8) ||        // loopback
    inRange("169.254.0.0", 16) ||     // link-local + metadata AWS/GCP
    inRange("0.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||      // CGNAT
    inRange("192.0.0.0", 24) ||
    inRange("198.18.0.0", 15) ||
    inRange("224.0.0.0", 4)           // multicast
  );
}
function isForbiddenHostname(h: string): boolean {
  const host = h.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal") return true;
  // IPv6 loopback/link-local/unique-local
  if (host === "[::1]" || host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) return true;
  // IPv4 literal
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPrivateIPv4(host);
  return false;
}
async function resolvesToPrivate(hostname: string): Promise<boolean> {
  if (isForbiddenHostname(hostname)) return true;
  try {
    // deno-lint-ignore no-explicit-any
    const dns = (Deno as any).resolveDns;
    if (typeof dns !== "function") return false;
    const [a4, a6] = await Promise.allSettled([dns(hostname, "A"), dns(hostname, "AAAA")]);
    if (a4.status === "fulfilled") {
      for (const ip of a4.value as string[]) if (isPrivateIPv4(ip)) return true;
    }
    if (a6.status === "fulfilled") {
      for (const ip of a6.value as string[]) {
        const lc = ip.toLowerCase();
        if (lc === "::1" || lc.startsWith("fc") || lc.startsWith("fd") || lc.startsWith("fe80")) return true;
      }
    }
    return false;
  } catch {
    // Se não conseguirmos resolver, seja conservador e rejeite
    return true;
  }
}

async function fetchWithTimeout(url: string, ms = 5000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "manual", // não seguimos redirects para evitar SSRF via redirect
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NaHoraBot/1.0)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extract(html: string): { email: string; confidence: "high" | "medium" }[] {
  const out = new Map<string, "high" | "medium">();
  const mailtoRe = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html))) {
    const e = normalize(m[1]);
    if (isValid(e)) out.set(e, "high");
  }
  const looseRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  while ((m = looseRe.exec(text))) {
    const e = normalize(m[0]);
    if (isValid(e) && !out.has(e)) out.set(e, "medium");
  }
  return [...out.entries()].map(([email, confidence]) => ({ email, confidence }));
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;

  try {
    const { website } = await req.json();
    if (!website || typeof website !== "string") {
      return new Response(JSON.stringify({ emails: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let base: URL;
    try {
      base = new URL(website.startsWith("http") ? website : `https://${website}`);
    } catch {
      return new Response(JSON.stringify({ emails: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (base.protocol !== "http:" && base.protocol !== "https:") {
      return new Response(JSON.stringify({ emails: [], error: "protocolo não permitido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (await resolvesToPrivate(base.hostname)) {
      return new Response(JSON.stringify({ emails: [], error: "host não permitido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const home = `${base.protocol}//${base.host}`;
    const paths = ["/", "/contato", "/contact", "/fale-conosco"];
    const htmls = await Promise.all(paths.map(p => fetchWithTimeout(home + p)));
    const all: { email: string; confidence: "high" | "medium" }[] = [];
    for (const h of htmls) if (h) all.push(...extract(h));

    const uniq = new Map<string, "high" | "medium">();
    for (const { email, confidence } of all) {
      if (!uniq.has(email) || confidence === "high") uniq.set(email, confidence);
    }

    return new Response(
      JSON.stringify({ emails: [...uniq.entries()].map(([email, confidence]) => ({ email, confidence })).slice(0, 5) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    console.error("site-email-scrape error:", err);
    return new Response(JSON.stringify({ emails: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
