import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, Star, MapPin, ExternalLink, Loader2, ImageOff, Globe } from 'lucide-react';
import { usePlacesEnrichment } from '@/hooks/usePlacesEnrichment';

interface Props {
  cnpj: string;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

export function LeadRichProfile(props: Props) {
  const { loading, data, error } = usePlacesEnrichment(props);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Buscando dados públicos (Google Places)...
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-muted-foreground py-2">Sem dados enriquecidos disponíveis.</div>;
  }

  if (!data || !data.found) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <ImageOff className="h-3.5 w-3.5" />
        Nenhuma correspondência no Google Places para esta empresa.
      </div>
    );
  }

  const telHref = data.phone ? `tel:${data.phone.replace(/[^\d+]/g, '')}` : null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Perfil público</span>
        {data._source === 'cache' && <Badge variant="outline" className="text-[10px] py-0 h-4">cache</Badge>}
      </div>

      {data.rating != null && (
        <div className="flex items-center gap-1.5 text-sm">
          <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />
          <span className="font-semibold">{data.rating.toFixed(1)}</span>
          {data.rating_count != null && (
            <span className="text-xs text-muted-foreground">({data.rating_count} avaliações)</span>
          )}
        </div>
      )}

      {data.formatted_address && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{data.formatted_address}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {telHref && (
          <Button asChild size="sm" variant="default" className="h-8">
            <a href={telHref}>
              <Phone className="h-3.5 w-3.5 mr-1.5" />
              Ligar {data.phone}
            </a>
          </Button>
        )}
        {data.formatted_address && (
          <Button asChild size="sm" variant="outline" className="h-8">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.formatted_address)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Maps
            </a>
          </Button>
        )}
        {data.website && (
          <Button asChild size="sm" variant="outline" className="h-8">
            <a href={data.website} target="_blank" rel="noopener noreferrer">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              Site
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
