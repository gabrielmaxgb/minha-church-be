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
    'Mesmas funcionalidades em todas as faixas. Você paga conforme o tamanho da sua igreja — não por pacote de recursos.',
  benefits: [
    'Membros, ministérios e escalas no mesmo lugar — sem planilha paralela',
    'Comunicados oficiais da liderança, sem virar grupo de WhatsApp',
    'Agenda de cultos e eventos com coleta de disponibilidade da equipe',
    'Permissões por cargo: cada líder vê e faz só o que precisa',
    'Histórico pastoral e cadastro centralizado, acessível com segurança',
    'Importação de membros por planilha em poucos minutos',
  ],
  valueAnchor: {
    headline:
      'Menos do que um turno de secretaria — e muito menos caos com planilhas, formulários soltos e grupos de WhatsApp.',
    example:
      'Para uma igreja com cerca de 200 membros cadastrados, o investimento fica em torno de R$ 1,45 por membro por mês no plano mensal.',
  },
  cta: 'Começar grátis',
  tiers: [
    {
      id: 'ate-100',
      name: 'Pequena Igreja',
      memberRange: 'Até 100 membros cadastrados',
      memberCountForPricePerMember: 100,
      monthlyPrice: 119,
      yearlyPrice: 1190,
    },
    {
      id: '101-300',
      name: 'Igreja em Crescimento',
      memberRange: '101 a 300 membros cadastrados',
      memberCountForPricePerMember: 200,
      monthlyPrice: 289,
      yearlyPrice: 2890,
      highlighted: true,
    },
    {
      id: '301-700',
      name: 'Igreja Consolidada',
      memberRange: '301 a 700 membros cadastrados',
      memberCountForPricePerMember: 500,
      monthlyPrice: 489,
      yearlyPrice: 4890,
    },
    {
      id: '701-plus',
      name: 'Multi-Congregação',
      memberRange: '701 membros cadastrados ou mais',
      memberCountForPricePerMember: 1000,
      monthlyPrice: 589,
      yearlyPrice: 5890,
    },
  ] satisfies BillingTierCatalogEntry[],
} as const;

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
