export const BILLING_TIER_IDS = [
  'ate-100',
  '101-300',
  '301-700',
  '701-plus',
] as const;

export type BillingTierId = (typeof BILLING_TIER_IDS)[number];
export type BillingInterval = 'monthly' | 'yearly';

/** Sufixo em inglês para variáveis STRIPE_PRICE_* (evita misturar PT/EN). */
export const TIER_STRIPE_ENV_KEYS: Record<BillingTierId, string> = {
  'ate-100': 'SMALL',
  '101-300': 'GROWTH',
  '301-700': 'CONSOLIDATED',
  '701-plus': 'MULTI',
};

export interface BillingTierCatalogEntry {
  id: BillingTierId;
  name: string;
  memberRange: string;
  memberCountForPricePerMember: number;
  monthlyPrice: number;
  yearlyPrice: number;
  highlighted?: boolean;
}

export const PRICING_CATALOG = {
  name: 'Minha Church',
  description:
    'As mesmas funcionalidades em todas as faixas. O valor é definido pelo número de membros, não por pacotes de recursos.',
  benefits: [
    'Membros, ministérios e escalas em um único ambiente',
    'Comunicados oficiais com histórico, fora do WhatsApp',
    'Dízimos e ofertas online, caixa e relatório mensal',
    'Pedidos de oração, aconselhamento e acompanhamento pastoral',
    'Agenda de cultos e eventos com coleta de disponibilidade',
    'Permissões por cargo, alinhadas à função de cada líder',
    'Importação de membros por planilha',
  ],
  valueAnchor: {
    headline:
      'Um custo inferior a um turno de secretaria — com menos dependência de planilhas, formulários soltos e grupos de WhatsApp.',
    example:
      'Em uma igreja com cerca de 200 membros, o valor mensal fica em torno de R$ 1,45 por membro.',
  },
  cta: 'Começar grátis',
  tiers: [
    {
      id: 'ate-100',
      name: 'Pequena Igreja',
      memberRange: 'Até 100 membros',
      memberCountForPricePerMember: 100,
      monthlyPrice: 119,
      yearlyPrice: 1190,
    },
    {
      id: '101-300',
      name: 'Igreja em Crescimento',
      memberRange: '101 a 300 membros',
      memberCountForPricePerMember: 200,
      monthlyPrice: 289,
      yearlyPrice: 2890,
      highlighted: true,
    },
    {
      id: '301-700',
      name: 'Igreja Consolidada',
      memberRange: '301 a 700 membros',
      memberCountForPricePerMember: 500,
      monthlyPrice: 489,
      yearlyPrice: 4890,
    },
    {
      id: '701-plus',
      name: 'Multi-Congregação',
      memberRange: '701 membros ou mais',
      memberCountForPricePerMember: 1000,
      monthlyPrice: 589,
      yearlyPrice: 5890,
    },
  ] satisfies BillingTierCatalogEntry[],
} as const;

/** Faixa de cobrança a partir da contagem de membros ativos (visitantes/inativos não entram). */
export function billingTierFromMemberCount(
  memberCount: number,
): BillingTierId {
  if (memberCount <= 100) {
    return 'ate-100';
  }

  if (memberCount <= 300) {
    return '101-300';
  }

  if (memberCount <= 700) {
    return '301-700';
  }

  return '701-plus';
}

export function billingTierIndex(tierId: BillingTierId): number {
  return BILLING_TIER_IDS.indexOf(tierId);
}

export function isBillingTierUpgrade(
  currentTierId: BillingTierId,
  projectedTierId: BillingTierId,
): boolean {
  return billingTierIndex(projectedTierId) > billingTierIndex(currentTierId);
}

export function wouldUpgradeBillingTier(
  currentMemberCount: number,
  projectedMemberCount: number,
): boolean {
  if (projectedMemberCount <= currentMemberCount) {
    return false;
  }

  const currentTier = billingTierFromMemberCount(currentMemberCount);
  const projectedTier = billingTierFromMemberCount(projectedMemberCount);

  return isBillingTierUpgrade(currentTier, projectedTier);
}

export function getBillingTierCatalogEntry(
  tierId: BillingTierId,
): BillingTierCatalogEntry {
  const tier = PRICING_CATALOG.tiers.find((item) => item.id === tierId);

  if (!tier) {
    throw new Error(`Faixa de preço desconhecida: ${tierId}`);
  }

  return tier;
}

export function stripePriceEnvKey(
  tierId: BillingTierId,
  interval: BillingInterval,
): string {
  const tierKey = TIER_STRIPE_ENV_KEYS[tierId];
  const intervalKey = interval === 'monthly' ? 'MONTHLY' : 'YEARLY';

  return `STRIPE_PRICE_${tierKey}_${intervalKey}`;
}
