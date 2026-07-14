# Decisões de arquitetura — Pagamentos (Stripe Connect)

Registro das decisões de produto/arquitetura do sistema financeiro. Atualizar
quando algo mudar. Contexto completo do setup do dashboard: `stripe-connect-setup.md`.

---

## 1. Acesso a "Recebimentos" x status da assinatura

**Decisão:** o **setup** de recebimentos fica sempre acessível; a **cobrança de
verdade** (Fase 2) é que tem gate por assinatura.

> **Atualização (Opção B — vigente):** recebimentos passaram a ser **recurso
> premium exclusivo de plano pago**, com liberação durante o **trial válido**
> (com selo "gratuito durante o teste"). Ver seção **1.1**. As Fases 1 e 2
> abaixo descrevem o modelo anterior e ficam **substituídas** por 1.1.

### Fase 1 — Setup (perfil fiscal + onboarding Connect + status) — *substituída*
- ~~**Liberado independente da assinatura**~~ (trial válido, trial expirado, etc.).
- Racional original: é caminho de conversão/ativação e **não move dinheiro**.
- Implementação antiga: exceção blanket no `subscription-write.guard.ts`
  (`/churches/:id/payments/` sempre passava). **Removida em 1.1.**

### Fase 2 — Cobrança (criar PaymentIntent / página pública) — *substituída*
- Modelo antigo (Opção A): trial válido/ativo liberava; expirado/inadimplente/
  cancelada bloqueava só o painel, **mantendo a página pública no ar**.
- Substituído pela Opção B (1.1): página pública também é bloqueada fora de
  plano pago/trial, com **janela de graça** só para `past_due`.

---

## 1.1 Recebimentos como recurso premium (Opção B — vigente)

**Decisão:** recebimentos (setup fiscal + Connect + fundos + página pública
`/doar`) são **premium**. Liberados apenas com `active` ou `trialing` válido.
`past_due`, `canceled` e trial expirado **bloqueiam tudo**, com uma exceção.

- **Trial:** tudo liberado, com selo no FE "Recurso premium — gratuito durante o
  teste". É gatilho de conversão: a igreja conecta a conta e sente o valor.
- **Setup deixou de ser exceção:** removida a exceção blanket
  `/churches/:id/payments/` do `subscription-write.guard.ts`. Passa a valer a
  régua padrão (trial válido libera; travado bloqueia perfil fiscal, Connect e
  fundos).
- **Página pública `/doar`:** `resolvePublicGivingContext`/`createGivingCheckout`
  checam `SubscriptionPolicyService.isPublicGivingEntitled`. Fora de direito →
  `ForbiddenException` com copy amigável; FE mostra página "indisponível".
- **Exceção `past_due` (graça):** `PAST_DUE_GRACE_DAYS` (default 7) mantém **só a
  página pública** no ar durante a graça, para não punir cartão vencido
  involuntário. `Church.pastDueSince` marca o início (setado/limpo em
  `billing.service`). `canceled` e trial expirado **nunca** têm graça.
- **Racional da mudança (A → B):** Opção A corria o risco de igrejas ficarem
  muito tempo em `past_due` usando recebimentos sem converter. Opção B reduz esse
  vazamento mantendo uma janela curta de graça para o caso legítimo de cartão
  vencido.

---

## 2. Pix em contas Express (BR)

**Decisão:** nunca pedir a capability `pix_payments` via API para contas Express.

- O Stripe recusa: *"The pix_payments capability is not requestable for accounts
  in BR."* Isso vale para Express (contas que "usam o Stripe Dashboard").
- Pix é ligado por outro caminho:
  1. **Default da plataforma** em Settings → Payment methods (Pix "On by
     default") — hoje esse toggle está **travado/cinza** enquanto o Pix não é
     formalmente ativado/elegível na conta plataforma; **ou**
  2. cada igreja liga o Pix no próprio **Express Dashboard** pós-onboarding.
- Estado atual do dashboard: Pix em **"Off by default"** (NÃO "Blocked"), então
  as igrejas ainda podem ativar por conta própria.
- Código: `createConnectedAccount` pede só `card_payments`, `boleto_payments` e
  `transfers`. `PAYMENTS_ENABLED_METHODS` pode conter `pix` (representa intenção),
  mas o código ignora pix na hora de pedir capability.
- `mapAccountToState` continua lendo `pix_payments` do account — se a igreja
  ativar, o status reflete corretamente.
- Pendência Fase 2: destravar "On by default" ativando o Pix formalmente na
  conta plataforma (provável exigir sair do sandbox / ativação live).

---

## 3. Liability e funds flow (platform profile)

- **Negative balance liability = Stripe** (não a plataforma). Menor risco
  financeiro pro Minha Church. Consequência: as features de Payments (View
  payments, Issue refunds, Manage disputes) devem **permanecer habilitadas** para
  as contas conectadas.
- **Funds flow declarado = "sellers collect payments directly"**. Isso aponta
  para **direct charges na conta conectada** (igreja = Merchant of Record), e não
  destination charge + `on_behalf_of`.

---

## 4. Tipo de cobrança (Fase 2)

**Decisão:** **direct charge** na conta conectada, com `application_fee_amount`
opcional (hoje `PAYMENTS_PLATFORM_FEE_BPS=0`).

- Igreja = Merchant of Record (aparece no comprovante).
- PaymentIntent criado com `Stripe-Account: acct_...`.
- Checkout público: `GET/POST /api/v1/public/giving/:churchSlug/:fundSlug`.
- Página FE: `/doar/[churchSlug]/[fundSlug]`.
- Recorrência (assinatura) **não** está no fundo — fica no checkout (fase futura).

---

## 5. Ordem do onboarding: fiscal antes do Connect

**Decisão:** só permitir criar a conta Connect depois da **identidade fiscal
mínima** salva no Minha Church. O form **não** espelha o onboarding do Stripe.

Campos no form (e no gate de ativação):
- CNPJ ou CPF
- Razão social
- Responsável legal
- CPF do responsável — **obrigatório só com CNPJ**

Fora do form (Stripe coleta no onboarding hospedado):
- Endereço, telefone, e-mail

Racional: o Stripe Express não devolve CNPJ/CPF depois; precisamos disso no app
para comprovantes, LGPD e relatórios. Pedir endereço/contato no app só gerava
digitação duplicada.

Prefill no `accounts.create`: documento + nomes (+ endereço/contato se já
existirem no banco via hydrate). Retomar onboarding de conta já criada não
exige revalidar o form.

---

## 6. Prefill religioso no Connect (MCC / descrição)

Na criação da conta Express (e de novo antes do Account Link) prefixamos:
- `business_profile.mcc = 8661` (Religious Organizations)
- `business_profile.product_description` explicando dízimos/doações/eventos
- `business_profile.url = https://www.minhachurch.com`

O onboarding hospedado do Stripe continua com copy genérica de “empresa”, mas
o setor/MCC e a descrição já saem alinhados a igreja — evita o usuário cair em
categorias de e-commerce (ex.: “Roupas e acessórios”).


