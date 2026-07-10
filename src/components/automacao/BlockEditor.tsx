import { useEffect, useState, useCallback } from 'react';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  GripVertical, Trash2, Copy, Type, Image as ImageIcon, MousePointerClick,
  MessageCircle, User, Minus, Bold, Italic, List as ListIcon, ListOrdered, Undo2, Redo2,
  Link as LinkIcon, Braces, Send, Save, CheckCircle2, Loader2,
} from 'lucide-react';
import {
  EmailBlock, BLOCK_LABELS, blocksToRenderedHtml, defaultBlockFor, duplicateBlock,
} from '@/lib/email-blocks';
import { EMAIL_VARIABLES, type EmailVariableContext } from '@/lib/email-variables';

interface Props {
  blocks: EmailBlock[];
  subject: string;
  onChange: (blocks: EmailBlock[], html: string) => void;
  onSubjectChange: (subject: string) => void;
  /** 'idle' | 'saving' | 'saved' | 'error' — shown next to the header. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  dirty?: boolean;
}

const ICONS: Record<EmailBlock['type'], React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
  button: <MousePointerClick className="h-4 w-4" />,
  whatsapp: <MessageCircle className="h-4 w-4" />,
  signature: <User className="h-4 w-4" />,
  divider: <Minus className="h-4 w-4" />,
};

function SortableBlock({
  block, isActive, onClick, onDelete, onDuplicate,
}: { block: EmailBlock; isActive: boolean; onClick: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`group flex items-start gap-2 rounded-md border p-2 cursor-pointer bg-card hover:border-primary/40 transition ${isActive ? 'border-primary ring-1 ring-primary/40' : ''}`}
    >
      <button {...attributes} {...listeners} className="mt-1 cursor-grab text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {ICONS[block.type]} {BLOCK_LABELS[block.type]}
        </div>
        <div className="text-sm truncate mt-0.5">
          {block.type === 'text' && (block.html.replace(/<[^>]+>/g, '') || 'Texto vazio')}
          {block.type === 'image' && block.url}
          {block.type === 'button' && `${block.label} → ${block.url}`}
          {block.type === 'whatsapp' && `${block.label} · ${block.phone}`}
          {block.type === 'signature' && `${block.name} · ${block.role}`}
          {block.type === 'divider' && '—'}
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button
          className="text-muted-foreground hover:text-primary"
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          title="Duplicar"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Rich text editor for text blocks. */
function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
    ],
    content: value || '<p></p>',
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[160px] p-3 border rounded-md bg-background',
      },
    },
  });

  // When the block being edited changes, sync content.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted ${active ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
    >
      {icon}
    </button>
  );

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL do link', prev ?? 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const insertVariable = (token: string) => {
    editor.chain().focus().insertContent(token).run();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap border rounded-md p-1 bg-muted/40">
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold className="h-3.5 w-3.5" />, 'Negrito')}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic className="h-3.5 w-3.5" />, 'Itálico')}
        {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <ListIcon className="h-3.5 w-3.5" />, 'Lista')}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="h-3.5 w-3.5" />, 'Lista numerada')}
        {btn(editor.isActive('link'), setLink, <LinkIcon className="h-3.5 w-3.5" />, 'Link')}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn(false, () => editor.chain().focus().undo().run(), <Undo2 className="h-3.5 w-3.5" />, 'Desfazer')}
        {btn(false, () => editor.chain().focus().redo().run(), <Redo2 className="h-3.5 w-3.5" />, 'Refazer')}
        <span className="mx-1 h-4 w-px bg-border" />
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" title="Inserir variável" className="h-7 px-2 inline-flex items-center gap-1 rounded hover:bg-muted text-xs text-muted-foreground">
              <Braces className="h-3.5 w-3.5" /> Variável
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {EMAIL_VARIABLES.map((v) => (
              <button
                key={v.token}
                onClick={() => insertVariable(v.token)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs"
              >
                <div className="font-medium">{v.label}</div>
                <div className="text-muted-foreground text-[10px] font-mono">{v.token}</div>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function BlockInspector({ block, onChange }: { block: EmailBlock; onChange: (b: EmailBlock) => void }) {
  const patch = (key: string, value: unknown) =>
    onChange({ ...(block as Record<string, unknown>), [key]: value } as unknown as EmailBlock);

  if (block.type === 'text') {
    return (
      <div className="space-y-2">
        <Label>Conteúdo</Label>
        <RichTextEditor value={block.html} onChange={(html) => patch('html', html)} />
      </div>
    );
  }
  if (block.type === 'image') {
    return (
      <div className="space-y-3">
        <div><Label>URL da imagem</Label><Input value={block.url} onChange={(e) => patch('url', e.target.value)} /></div>
        <div><Label>Texto alternativo</Label><Input value={block.alt ?? ''} onChange={(e) => patch('alt', e.target.value)} /></div>
        <div><Label>Largura (px)</Label><Input type="number" value={block.width ?? 600} onChange={(e) => patch('width', parseInt(e.target.value) || 600)} /></div>
      </div>
    );
  }
  if (block.type === 'button') {
    return (
      <div className="space-y-3">
        <div><Label>Texto do botão</Label><Input value={block.label} onChange={(e) => patch('label', e.target.value)} /></div>
        <div><Label>Link</Label><Input value={block.url} onChange={(e) => patch('url', e.target.value)} /></div>
        <div><Label>Cor de fundo</Label><Input type="color" value={block.color ?? '#0f766e'} onChange={(e) => patch('color', e.target.value)} /></div>
        <div><Label>Cor do texto</Label><Input type="color" value={block.textColor ?? '#ffffff'} onChange={(e) => patch('textColor', e.target.value)} /></div>
      </div>
    );
  }
  if (block.type === 'whatsapp') {
    return (
      <div className="space-y-3">
        <div><Label>Texto do botão</Label><Input value={block.label} onChange={(e) => patch('label', e.target.value)} /></div>
        <div><Label>Telefone (com DDI, só números)</Label><Input value={block.phone} onChange={(e) => patch('phone', e.target.value)} placeholder="5511999999999" /></div>
        <div><Label>Mensagem pré-preenchida</Label><Textarea rows={3} value={block.message} onChange={(e) => patch('message', e.target.value)} /></div>
      </div>
    );
  }
  if (block.type === 'signature') {
    return (
      <div className="space-y-3">
        <div><Label>Nome</Label><Input value={block.name} onChange={(e) => patch('name', e.target.value)} /></div>
        <div><Label>Cargo</Label><Input value={block.role} onChange={(e) => patch('role', e.target.value)} /></div>
        <div><Label>Foto (URL)</Label><Input value={block.photoUrl ?? ''} onChange={(e) => patch('photoUrl', e.target.value)} /></div>
        <div><Label>LinkedIn</Label><Input value={block.linkedin ?? ''} onChange={(e) => patch('linkedin', e.target.value)} /></div>
        <div><Label>Instagram</Label><Input value={block.instagram ?? ''} onChange={(e) => patch('instagram', e.target.value)} /></div>
        <div><Label>Site</Label><Input value={block.website ?? ''} onChange={(e) => patch('website', e.target.value)} /></div>
      </div>
    );
  }
  if (block.type === 'divider') {
    return (
      <div className="space-y-2">
        <Label>Cor da linha</Label>
        <Input type="color" value={block.color ?? '#e2e8f0'} onChange={(e) => patch('color', e.target.value)} />
      </div>
    );
  }
  return null;
}

export function BlockEditor({ blocks, subject, onChange, onSubjectChange, saveState, dirty }: Props) {
  const { profile } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(blocks[0]?.id ?? null);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // preview context (uses [Placeholder] labels)
  const previewCtx: EmailVariableContext = {
    lead: { nome: null, empresa: null, cidade: null, setor: null, email: null, telefone: null },
    sdr: { nome: profile?.full_name ?? null },
  };

  const emit = useCallback((next: EmailBlock[]) => {
    onChange(next, blocksToRenderedHtml(next, previewCtx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const addBlock = (type: EmailBlock['type']) => {
    const b = defaultBlockFor(type);
    const next = [...blocks, b];
    emit(next);
    setActiveId(b.id);
  };
  const updateBlock = (b: EmailBlock) => emit(blocks.map((x) => (x.id === b.id ? b : x)));
  const deleteBlock = (id: string) => {
    const next = blocks.filter((b) => b.id !== id);
    emit(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  };
  const duplicate = (id: string) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const clone = duplicateBlock(blocks[idx]);
    const next = [...blocks.slice(0, idx + 1), clone, ...blocks.slice(idx + 1)];
    emit(next);
    setActiveId(clone.id);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIdx = blocks.findIndex((b) => b.id === active.id);
      const newIdx = blocks.findIndex((b) => b.id === over.id);
      emit(arrayMove(blocks, oldIdx, newIdx));
    }
  };

  const sendTest = async () => {
    if (!testEmail || !profile) return;
    setTestSending(true);
    try {
      const html = blocksToRenderedHtml(blocks, {
        lead: { nome: 'Teste', empresa: 'Empresa Teste', cidade: 'Sua Cidade' },
        sdr: { nome: profile.full_name ?? undefined },
      });
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: testEmail,
          subject: `[TESTE] ${subject || '(sem assunto)'}`,
          body_html: html,
          sdr_id: profile.id,
          test: true,
        },
      });
      if (error) throw error;
      const payload = data as { success?: boolean; error?: string } | null;
      if (payload && payload.success === false) throw new Error(payload.error ?? 'falhou');
      toast.success(`E-mail de teste enviado para ${testEmail}`);
      setTestOpen(false);
    } catch (e) {
      toast.error('Falha no envio de teste', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestSending(false);
    }
  };

  const activeBlock = blocks.find((b) => b.id === activeId) ?? null;
  const html = blocksToRenderedHtml(blocks, previewCtx, { previewMode: true });

  const stateBadge = (() => {
    if (saveState === 'saving') return <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Salvando…</span>;
    if (saveState === 'error') return <span className="text-xs text-destructive">Falha ao salvar</span>;
    if (dirty) return <span className="text-xs text-amber-600 inline-flex items-center gap-1"><Save className="h-3 w-3" />Não salvo</span>;
    if (saveState === 'saved') return <span className="text-xs text-success inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Salvo</span>;
    return null;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 min-h-[500px]">
      <Card className="p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex-1">
            <Label className="text-xs">Assunto</Label>
            <Input value={subject} onChange={(e) => onSubjectChange(e.target.value)} placeholder="Assunto do e-mail" />
          </div>
        </div>
        <div className="flex items-center justify-between mb-2">
          {stateBadge ?? <span />}
          <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
            <Send className="h-3.5 w-3.5 mr-1" /> Enviar teste
          </Button>
        </div>
        <Tabs defaultValue="content">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="content">Conteúdo</TabsTrigger>
            <TabsTrigger value="insert">Inserir</TabsTrigger>
          </TabsList>
          <TabsContent value="content" className="space-y-2 mt-3">
            {blocks.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum bloco. Vá em "Inserir".</p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {blocks.map((b) => (
                    <SortableBlock
                      key={b.id}
                      block={b}
                      isActive={b.id === activeId}
                      onClick={() => setActiveId(b.id)}
                      onDelete={() => deleteBlock(b.id)}
                      onDuplicate={() => duplicate(b.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {activeBlock && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium mb-2 text-muted-foreground">
                  Editar: {BLOCK_LABELS[activeBlock.type]}
                </p>
                <BlockInspector block={activeBlock} onChange={updateBlock} />
              </div>
            )}
          </TabsContent>
          <TabsContent value="insert" className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(BLOCK_LABELS) as EmailBlock['type'][]).map((t) => (
              <Button key={t} variant="outline" size="sm" onClick={() => addBlock(t)} className="justify-start gap-2">
                {ICONS[t]} {BLOCK_LABELS[t]}
              </Button>
            ))}
          </TabsContent>
        </Tabs>
      </Card>

      <Card className="p-4 overflow-auto bg-muted/30">
        <p className="text-xs text-muted-foreground mb-2">Prévia (variáveis aparecem como [Rótulo])</p>
        <div className="rounded-md bg-white shadow-sm">
          <div className="border-b px-4 py-2 text-xs text-muted-foreground">
            <strong>Assunto:</strong> {subject || '(sem assunto)'}
          </div>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </Card>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar e-mail de teste</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Enviar para</Label>
            <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="voce@empresa.com" type="email" />
            <p className="text-xs text-muted-foreground">Usa dados fictícios ("Teste", "Empresa Teste", "Sua Cidade") para preencher as variáveis.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancelar</Button>
            <Button onClick={sendTest} disabled={!testEmail || testSending}>
              {testSending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
