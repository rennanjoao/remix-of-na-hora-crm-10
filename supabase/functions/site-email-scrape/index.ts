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

async function fetchWithTimeout(url: string, ms = 5000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
