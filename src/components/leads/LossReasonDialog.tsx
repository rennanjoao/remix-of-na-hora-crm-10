import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const LOSS_REASONS = [
  { value: 'sem_orcamento', label: 'Sem orçamento' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'contato_invalido', label: 'Contato inválido' },
  { value: 'fora_do_perfil', label: 'Fora do perfil' },
  { value: 'concorrente', label: 'Concorrente' },
  { value: 'timing_inadequado', label: 'Timing inadequado' },
  { value: 'duplicado', label: 'Duplicado' },
  { value: 'outro', label: 'Outro' },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName?: string | null;
  /** Deve lançar erro em caso de falha — o modal mantém-se aberto. */
  onConfirm: (reason: string) => Promise<void> | void;
}

export function LossReasonDialog({ open, onOpenChange, leadName, onConfirm }: Props) {
  const [selected, setSelected] = useState<string>('');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSelected(''); setOther(''); setSaving(false); }
  }, [open]);

  const isOther = selected === 'outro';
  const valid = !!selected && (!isOther || other.trim().length >= 3);

  const confirm = async () => {
    if (!valid) return;
    const label = LOSS_REASONS.find(r => r.value === selected)?.label ?? selected;
    const reason = isOther ? `Outro: ${other.trim()}` : label;
    setSaving(true);
    try {
      await onConfirm(reason);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Motivo da perda</DialogTitle>
          <DialogDescription>
            {leadName ? `Informe por que ${leadName} foi perdido.` : 'Informe o motivo da perda deste lead.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {LOSS_REASONS.map(r => (
            <Button
              key={r.value}
              type="button"
              variant={selected === r.value ? 'default' : 'outline'}
              size="sm"
              className={cn('justify-start text-xs h-9')}
              onClick={() => setSelected(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {isOther && (
          <Textarea
            autoFocus
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Descreva o motivo (mínimo 3 caracteres)"
            rows={3}
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={!valid || saving}>
            {saving ? 'Salvando...' : 'Confirmar perda'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
