# Decisões de arquitetura — Pagamentos (Stripe Connect)

Registro das decisões de produto/arquitetura do sistema financeiro. Atualizar
quando algo mudar. Contexto completo do setup do dashboard: `stripe-connect-setup.md`.

---

## 1. Acesso a "Recebimentos" x status da assinatura

**Decisão:** o **setup** de recebimentos fica sempre acessível; a **cobrança de
verdade** (Fase 2) é que tem gate por assinatura.

### Fase 1 — Setup (perfil fiscal + onboarding Connect + status)
- **Liberado independente da assinatura** (trial válido, trial expirado, etc.).
- Racional: é caminho de conversão/ativação e **não move dinheiro**. Ter conta
  conectada criada não gera risco nem custo.
- Implementação: exceção já existente no `subscription-write.guard.ts`
  (`/churches/:id/payments/` sempre passa). **Não remover.**

### Fase 2 — Cobrança (criar PaymentIntent / página pública)
- Trial válido **ou** plano ativo → cobrança liberada.
- Trial expirado / inadimplente / cancelada → **bloquear criar novas cobranças
  no painel**, mas **manter páginas públicas já ativas funcionando**.
- Racional do "não derrubar página pública": o dinheiro é da igreja e um membro
  tentando dizimar não pode ver "indisponível" — quebra confiança do membro
  final. Painel bloqueia gestão nova; checkout existente continua no ar com CTA
  pro dono reativar o plano.
- Gate deve ficar na **camada de criação de cobrança**, não no acesso à seção.
- Alternativa mais dura (expirou = corta tudo, inclusive página pública) foi
  considerada e **descartada** pelo atrito com o membro final.

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


