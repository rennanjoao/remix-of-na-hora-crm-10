import { useEffect, useRef, useState } from 'react';
import { Building2 } from 'lucide-react';

/**
 * Cache global de URLs de fachada por place_id.
 * Evita reconstruir/rebuscar quando o mesmo lead aparece em múltiplos contextos.
 */
const facadeUrlCache = new Map<string, string | null>();

const SUPABASE_URL = 'https://cyekmwsgpcxjakpbeyea.supabase.co';
function photoUrl(name: string, w = 240) {
  return `${SUPABASE_URL}/functions/v1/places-enrich?photo_name=${encodeURIComponent(name)}&max_width=${w}`;
}

export interface FacadeItem {
  place_id: string;
  display_name: string | null;
  photo_name?: string | null;
  fallback_url?: string | null;
}

interface Props {
  items: FacadeItem[];
  onRemove?: (place_id: string) => void;
}

/**
 * Grid de miniaturas de fachadas com lazy loading via IntersectionObserver.
 * A tag <img> só recebe src quando o card entra no viewport, evitando
 * dezenas de requisições paralelas ao Places API na main thread.
 */
export function FacadeImageGrid({ items, onRemove }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {items.map((it) => (
        <FacadeThumb key={it.place_id} item={it} onRemove={onRemove} />
      ))}
    </div>
  );
}

function FacadeThumb({ item, onRemove }: { item: FacadeItem; onRemove?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(() => facadeUrlCache.get(item.place_id) ?? null);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || src !== null) return;
    const url = item.photo_name ? photoUrl(item.photo_name, 240) : (item.fallback_url ?? null);
    facadeUrlCache.set(item.place_id, url);
    setSrc(url);
  }, [visible, src, item]);

  return (
    <div
      ref={ref}
      className="group relative aspect-square rounded-md border border-border bg-muted overflow-hidden"
      title={item.display_name ?? ''}
    >
      {visible && src ? (
        <img
          src={src}
          alt={item.display_name ?? ''}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Building2 className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1">
        <p className="text-[10px] text-white line-clamp-1">{item.display_name}</p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.place_id)}
          className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
          aria-label="Remover"
        >
          ×
        </button>
      )}
    </div>
  );
}
