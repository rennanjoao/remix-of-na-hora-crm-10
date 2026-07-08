import { supabase } from '@/integrations/supabase/client';

export interface ApproachScript {
  id: string;
  name: string;
  channel: string;
  body: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScriptVars {
  nome?: string | null;
  cidade?: string | null;
  segmento?: string | null;
}

/**
 * Substitui {nome}, {cidade}, {segmento} pelos valores reais.
 * Placeholders vazios são substituídos por string vazia (o próprio texto
 * do script deve prever contexto — ex: "vi que vocês atuam no segmento {segmento}").
 */
export function interpolateScript(body: string, vars: ScriptVars): string {
  return body
    .replace(/\{nome\}/g, vars.nome?.trim() || '')
    .replace(/\{cidade\}/g, vars.cidade?.trim() || '')
    .replace(/\{segmento\}/g, vars.segmento?.trim() || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cache em memória: evita bater no banco toda vez que abre um WhatsApp. */
let cache: { at: number; scripts: ApproachScript[] } | null = null;
const TTL_MS = 60_000;

async function loadScripts(): Promise<ApproachScript[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.scripts;
  const { data } = await (supabase.from('approach_scripts' as never) as any)
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  const scripts = (data || []) as ApproachScript[];
  cache = { at: Date.now(), scripts };
  return scripts;
}

/**
 * Retorna o script default do canal informado, ou null caso não exista.
 * Usado com fallback pelo caller (nunca deve quebrar o fluxo se a tabela estiver vazia).
 */
export async function getDefaultScript(channel: 'whatsapp' | 'email' = 'whatsapp'): Promise<ApproachScript | null> {
  const all = await loadScripts();
  return all.find(s => s.channel === channel && s.is_default)
      ?? all.find(s => s.channel === channel)
      ?? null;
}

export function invalidateScriptsCache() { cache = null; }
