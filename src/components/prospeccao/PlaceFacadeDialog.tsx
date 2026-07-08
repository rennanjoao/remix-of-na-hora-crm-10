import { useState } from 'react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Camera, ImageOff } from 'lucide-react';
import { usePlacesEnrichment, placePhotoUrl } from '@/hooks/usePlacesEnrichment';

interface Props {
  cnpj: string;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

export function PlaceFacadeDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const { data, loading } = usePlacesEnrichment(props);

  const firstPhoto = data?.photos?.[0];
  const thumbUrl = firstPhoto ? placePhotoUrl(firstPhoto.name, 160) : null;
  const fullUrl = firstPhoto ? placePhotoUrl(firstPhoto.name, 1600) : null;
  const title = data?.display_name || props.nomeFantasia || props.razaoSocial || 'Fachada';

  if (loading && !data) {
    return <Skeleton className="h-9 w-28 rounded-md" />;
  }

  if (!firstPhoto) {
    return (
      <Button variant="outline" size="sm" disabled className="h-9 gap-1.5 text-xs">
        <ImageOff className="h-3.5 w-3.5" />
        Sem fachada
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setImgLoaded(false); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group relative h-14 w-20 shrink-0 overflow-hidden rounded-md border border-border/60 hover:border-primary/60 transition"
          aria-label="Ver fachada"
        >
          {thumbUrl && (
            <img
              src={thumbUrl}
              alt="Fachada"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/50 transition">
            <Camera className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition drop-shadow" />
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl border-none p-2 bg-background/95 backdrop-blur">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative w-full">
          {!imgLoaded && (
            <Skeleton className="absolute inset-0 h-[60vh] w-full rounded-md" />
          )}
          {open && fullUrl && (
            <img
              src={fullUrl}
              alt={title}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              className="w-full h-[60vh] object-cover rounded-md"
            />
          )}
        </div>
        <div className="px-2 pt-2 pb-1">
          <p className="text-sm font-medium truncate">{title}</p>
          {data?.formatted_address && (
            <p className="text-xs text-muted-foreground truncate">{data.formatted_address}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
