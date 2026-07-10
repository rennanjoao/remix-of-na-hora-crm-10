// Email block types and HTML generator
import DOMPurify from 'isomorphic-dompurify';
import { renderVariables, type EmailVariableContext } from './email-variables';

export type EmailBlock =
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'image'; url: string; alt?: string; width?: number; align?: 'left' | 'center' | 'right' }
  | { id: string; type: 'button'; label: string; url: string; color?: string; textColor?: string; align?: 'left' | 'center' | 'right' }
  | { id: string; type: 'whatsapp'; label: string; phone: string; message: string; color?: string }
  | { id: string; type: 'signature'; name: string; role: string; photoUrl?: string; linkedin?: string; instagram?: string; website?: string }
  | { id: string; type: 'divider'; color?: string };

export const BLOCK_LABELS: Record<EmailBlock['type'], string> = {
  text: 'Texto',
  image: 'Imagem',
  button: 'Botão',
  whatsapp: 'Botão WhatsApp',
  signature: 'Assinatura',
  divider: 'Divisor',
};

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sanitize HTML from the text editor before injecting anywhere. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'src', 'alt', 'width', 'height'],
    FORBID_TAGS: ['script', 'iframe', 'style', 'object', 'embed', 'form', 'input'],
  });
}

const wrapAlign = (align: string | undefined, content: string) =>
  `<div style="text-align:${align ?? 'left'};margin:16px 0;">${content}</div>`;

export function blockToHtml(b: EmailBlock): string {
  switch (b.type) {
    case 'text':
      return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;margin:12px 0;">${sanitizeHtml(b.html || '')}</div>`;
    case 'image': {
      const w = b.width ? `width="${b.width}"` : '';
      const img = `<img src="${escape(b.url)}" alt="${escape(b.alt ?? '')}" ${w} style="max-width:100%;height:auto;border-radius:8px;display:inline-block;" />`;
      return wrapAlign(b.align, img);
    }
    case 'button': {
      const bg = b.color ?? '#0f766e';
      const fg = b.textColor ?? '#ffffff';
      const btn = `<a href="${escape(b.url)}" style="display:inline-block;background:${bg};color:${fg};padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-family:Inter,Arial,sans-serif;font-size:14px;">${escape(b.label)}</a>`;
      return wrapAlign(b.align, btn);
    }
    case 'whatsapp': {
      const phone = b.phone.replace(/\D/g, '');
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(b.message)}`;
      const bg = b.color ?? '#25D366';
      const btn = `<a href="${url}" style="display:inline-block;background:${bg};color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-family:Inter,Arial,sans-serif;font-size:14px;">💬 ${escape(b.label)}</a>`;
      return wrapAlign('center', btn);
    }
    case 'signature': {
      const links: string[] = [];
      if (b.linkedin) links.push(`<a href="${escape(b.linkedin)}" style="color:#0f766e;text-decoration:none;margin-right:8px;">LinkedIn</a>`);
      if (b.instagram) links.push(`<a href="${escape(b.instagram)}" style="color:#0f766e;text-decoration:none;margin-right:8px;">Instagram</a>`);
      if (b.website) links.push(`<a href="${escape(b.website)}" style="color:#0f766e;text-decoration:none;">Site</a>`);
      const photo = b.photoUrl
        ? `<td style="padding-right:14px;vertical-align:top;"><img src="${escape(b.photoUrl)}" width="56" height="56" style="border-radius:50%;object-fit:cover;display:block;" alt="" /></td>`
        : '';
      return `
<table style="margin:24px 0;border-top:1px solid #e2e8f0;padding-top:16px;font-family:Inter,Arial,sans-serif;">
  <tr>
    ${photo}
    <td style="vertical-align:top;">
      <div style="font-weight:600;color:#0f172a;font-size:14px;">${escape(b.name)}</div>
      <div style="color:#64748b;font-size:13px;margin-top:2px;">${escape(b.role)}</div>
      ${links.length ? `<div style="margin-top:6px;font-size:12px;">${links.join('')}</div>` : ''}
    </td>
  </tr>
</table>`;
    }
    case 'divider':
      return `<hr style="border:none;border-top:1px solid ${b.color ?? '#e2e8f0'};margin:20px 0;" />`;
  }
}

export function blocksToHtml(blocks: EmailBlock[]): string {
  const body = blocks.map(blockToHtml).join('\n');
  return `<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">${body}</div>`;
}

/**
 * Renders blocks with variable substitution (for preview / test send).
 * The server-side sender does the final substitution against the real lead.
 */
export function blocksToRenderedHtml(
  blocks: EmailBlock[],
  ctx: EmailVariableContext,
  opts: { previewMode?: boolean } = {},
): string {
  const html = blocksToHtml(blocks);
  return renderVariables(html, ctx, opts);
}

export function defaultBlockFor(type: EmailBlock['type']): EmailBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case 'text':
      return { id, type: 'text', html: '<p>Escreva seu texto aqui... Use {{lead.nome}} para personalizar.</p>' };
    case 'image':
      return { id, type: 'image', url: 'https://placehold.co/600x300', alt: '', width: 600, align: 'center' };
    case 'button':
      return { id, type: 'button', label: 'Saiba mais', url: 'https://', color: '#0f766e', textColor: '#ffffff', align: 'center' };
    case 'whatsapp':
      return { id, type: 'whatsapp', label: 'Falar no WhatsApp', phone: '5511999999999', message: 'Olá! Vi seu contato e gostaria de conversar.', color: '#25D366' };
    case 'signature':
      return { id, type: 'signature', name: 'Seu Nome', role: 'Cargo · Na Hora Transporte', photoUrl: '', linkedin: '', instagram: '', website: '' };
    case 'divider':
      return { id, type: 'divider', color: '#e2e8f0' };
  }
}

/** Deep-clone a block and assign a fresh id — used by the editor's Duplicate action. */
export function duplicateBlock(b: EmailBlock): EmailBlock {
  return { ...b, id: crypto.randomUUID() } as EmailBlock;
}
