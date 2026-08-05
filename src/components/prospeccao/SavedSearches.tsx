import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Bookmark, BookmarkPlus, Loader2, Trash2 } from 'lucide-react';

export interface SavedSearchState {
  query: string;
  zone: string | null;
  emailFilter: string;
}

interface SavedSearchRow extends SavedSearchState {
  id: string;
  name: string;
}

interface Props {
  current: SavedSearchState;
  onApply: (s: SavedSearchState) => void;
}

export function SavedSearches({ current, onApply }: Props) {
  const { profile } = useAuth();
  const [items, setItems] = useState<SavedSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchItems = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('saved_searches')
        .select('id,name,query,zone,email_filter')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems((data ?? []).map(r => ({
        id: r.id,
        name: r.name,
        query: r.query,
        zone: r.zone,
        emailFilter: r.email_filter ?? 'todos',
      })));
    } catch (e) {
      console.error('Error loading saved searches:', e);
      toast.error('Erro ao carregar buscas salvas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profile?.id]);

  const save = async () => {
    if (!profile) return;
    const finalName = name.trim() || current.query.trim();
    if (!finalName) { toast.error('Dê um nome à busca'); return; }
    if (!current.query.trim()) { toast.error('Faça uma busca antes de salvar'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('saved_searches').insert({
        sdr_id: profile.id,
        name: finalName,
        query: current.query,
        zone: current.zone,
        email_filter: current.emailFilter,
      });
      if (error) throw error;
      toast.success('Busca salva');
      setSaveOpen(false); setName('');
      void fetchItems();
    } catch (e) {
      console.error('Error saving search:', e);
      toast.error('Erro ao salvar busca', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const { error } = await supabase.from('saved_searches').delete().eq('id', id);
      if (error) throw error;
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e) {
      console.error('Error deleting saved search:', e);
      toast.error('Erro ao excluir busca');
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            Buscas salvas
            {items.length > 0 && <span className="text-xs text-muted-foreground">({items.length})</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Suas buscas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading && (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              Nenhuma busca salva. Faça uma busca e clique em "Salvar busca" para reutilizá-la depois.
            </div>
          )}
          {items.map(item => (
            <DropdownMenuItem
              key={item.id}
              className="flex items-start justify-between gap-2"
              onSelect={() => onApply({ query: item.query, zone: item.zone, emailFilter: item.emailFilter })}
            >
              <div className="min-w-0">
                <p className="text-sm truncate">{item.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{item.query}</p>
              </div>
              <button
                type="button"
                aria-label={`Excluir ${item.name}`}
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); void remove(item.id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setName(current.query); setSaveOpen(true); }}>
        <BookmarkPlus className="h-3.5 w-3.5" /> Salvar busca
      </Button>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Salvar busca atual</DialogTitle>
            <DialogDescription>
              Guarda o termo, a zona e o filtro de e-mail para você repetir com um clique.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="saved-search-name" className="text-xs">Nome</Label>
            <Input id="saved-search-name" value={name} onChange={e => setName(e.target.value)} placeholder="Distribuidoras Zona Leste" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
