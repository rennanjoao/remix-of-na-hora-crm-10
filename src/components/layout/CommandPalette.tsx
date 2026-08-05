import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { Building2, Crosshair, Users, Radar, Send, CalendarDays } from 'lucide-react';

interface LeadHit {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cidade: string | null;
  estado: string | null;
}

const PAGES = [
  { label: 'Foco do Dia', path: '/foco', icon: Crosshair },
  { label: 'Pipeline de Leads', path: '/leads', icon: Users },
  { label: 'Prospecção', path: '/prospeccao', icon: Radar },
  { label: 'Automação de E-mail', path: '/automacao', icon: Send },
  { label: 'Calendário', path: '/calendario', icon: CalendarDays },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<LeadHit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setHits([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const digits = q.replace(/\D/g, '');
        const filter = digits.length >= 4
          ? `razao_social.ilike.%${q}%,nome_fantasia.ilike.%${q}%,cnpj.ilike.%${digits}%`
          : `razao_social.ilike.%${q}%,nome_fantasia.ilike.%${q}%`;
        const { data, error } = await supabase
          .from('leads')
          .select('id,razao_social,nome_fantasia,cidade,estado')
          .or(filter)
          .limit(8);
        if (error) throw error;
        if (!cancelled) setHits(data ?? []);
      } catch (e) {
        console.error('Command palette search failed:', e);
        if (!cancelled) setHits([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term]);

  const go = (path: string) => { setOpen(false); setTerm(''); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Buscar lead por nome ou CNPJ, ou navegar..."
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>Nada encontrado. Tente outro nome ou CNPJ.</CommandEmpty>
        {hits.length > 0 && (
          <>
            <CommandGroup heading="Leads">
              {hits.map(h => (
                <CommandItem key={h.id} value={`lead-${h.id}-${h.razao_social}`} onSelect={() => go(`/leads?lead=${h.id}`)}>
                  <Building2 className="mr-2 h-4 w-4" />
                  <span className="truncate">{h.nome_fantasia || h.razao_social}</span>
                  {(h.cidade || h.estado) && (
                    <span className="ml-2 text-xs text-muted-foreground truncate">
                      {[h.cidade, h.estado].filter(Boolean).join('/')}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading="Ir para">
          {PAGES.map(p => (
            <CommandItem key={p.path} value={p.label} onSelect={() => go(p.path)}>
              <p.icon className="mr-2 h-4 w-4" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
