import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search } from 'lucide-react';

interface CNPJSearchCardProps {
  onSearch: (cnpj: string) => void;
  loading: boolean;
}

function formatCNPJInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function CNPJSearchCard({ onSearch, loading }: CNPJSearchCardProps) {
  const [cnpj, setCnpj] = useState('');

  const digits = cnpj.replace(/\D/g, '');
  const isValid = digits.length === 14;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) onSearch(digits);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Consulta de CNPJ
        </CardTitle>
        <CardDescription>
          Pesquise dados oficiais da Receita Federal via Brasil API
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <Input
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => setCnpj(formatCNPJInput(e.target.value))}
            className="max-w-xs font-mono"
          />
          <Button type="submit" disabled={!isValid || loading}>
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Consultando...</>
            ) : (
              <><Search className="h-4 w-4 mr-2" />Consultar</>
            )}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          {digits.length}/14 dígitos
        </p>
      </CardContent>
    </Card>
  );
}
