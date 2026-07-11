import { Gender, MaritalStatus, type Prisma } from '@prisma/client';

/** Campos pastorais que tornam o cadastro “completo” para testes (nascimento, contato, endereço). */
export type CompletePastoralProfile = Pick<
  Prisma.MemberCreateManyInput,
  | 'phone'
  | 'birthDate'
  | 'gender'
  | 'maritalStatus'
  | 'street'
  | 'number'
  | 'neighborhood'
  | 'city'
  | 'state'
  | 'zipCode'
>;

const COMPLETE_PROFILE_TEMPLATES: CompletePastoralProfile[] = [
  {
    phone: '(11) 98888-1001',
    birthDate: new Date('1988-03-12'),
    gender: Gender.female,
    maritalStatus: MaritalStatus.married,
    street: 'Rua das Palmeiras',
    number: '120',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01001000',
  },
  {
    phone: '(11) 98888-1002',
    birthDate: new Date('1992-07-21'),
    gender: Gender.male,
    maritalStatus: MaritalStatus.single,
    street: 'Av. Paulista',
    number: '1500',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310100',
  },
  {
    phone: '(11) 98888-1003',
    birthDate: new Date('1985-11-04'),
    gender: Gender.female,
    maritalStatus: MaritalStatus.married,
    street: 'Rua Augusta',
    number: '890',
    neighborhood: 'Consolação',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01305000',
  },
  {
    phone: '(11) 98888-1004',
    birthDate: new Date('1990-01-30'),
    gender: Gender.male,
    maritalStatus: MaritalStatus.divorced,
    street: 'Rua Domingos de Morais',
    number: '450',
    neighborhood: 'Vila Mariana',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '04010000',
  },
];

/** Índice 0..(n-1): pelo menos a primeira metade recebe cadastro completo. */
export function shouldHaveCompleteProfile(index: number, total: number): boolean {
  if (total <= 0) {
    return false;
  }

  return index < Math.ceil(total / 2);
}

export function completePastoralProfileForIndex(
  index: number,
  overrides?: Partial<CompletePastoralProfile>,
): CompletePastoralProfile {
  const template =
    COMPLETE_PROFILE_TEMPLATES[index % COMPLETE_PROFILE_TEMPLATES.length]!;

  return {
    ...template,
    ...overrides,
  };
}
