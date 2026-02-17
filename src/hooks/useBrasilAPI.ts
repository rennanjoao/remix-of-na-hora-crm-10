import { useState } from 'react';
import { toast } from 'sonner';

export interface BrasilAPICompany {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  ddd_telefone_1: string;
  ddd_telefone_2: string;
  email: string | null;
  situacao_cadastral: number;
  descricao_situacao_cadastral: string;
  data_inicio_atividade: string;
  porte: string;
  natureza_juridica: string;
  capital_social: number;
  [key: string]: unknown;
}

export function useBrasilAPI() {
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState<BrasilAPICompany | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanCNPJ = (cnpj: string) => cnpj.replace(/\D/g, '');

  const searchCNPJ = async (cnpj: string) => {
    const cleaned = cleanCNPJ(cnpj);
    if (cleaned.length !== 14) {
      toast.error('CNPJ deve ter 14 dígitos');
      return null;
    }

    setLoading(true);
    setError(null);
    setCompany(null);

    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleaned}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('CNPJ não encontrado na base da Receita Federal');
        throw new Error(`Erro na consulta (${res.status})`);
      }
      const data: BrasilAPICompany = await res.json();
      setCompany(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao consultar CNPJ';
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setCompany(null);
    setError(null);
  };

  return { searchCNPJ, company, loading, error, reset, cleanCNPJ };
}
