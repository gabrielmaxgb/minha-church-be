# Configuração do Stripe Connect — Recebimentos do Minha Church

> **Este documento é um briefing para uma IA de navegador (ChatGPT Atlas) que vai
> me guiar clicando pelo Stripe Dashboard.** Ele traz (1) o contexto do produto e
> da arquitetura, (2) o "contrato técnico" que o backend já implementou e espera do
> Stripe, e (3) um passo a passo navegável com o que clicar, o que procurar e quais
> valores devolver ao usuário. Leia as seções 0, 1 e 2 antes de começar a clicar.

---

## 0. Instruções para a IA que está guiando (LEIA PRIMEIRO)

**Seu papel:** guiar o usuário (proprietário da plataforma Minha Church) a configurar
o Stripe Connect no Dashboard, passo a passo, explicando cada tela. O usuário
compartilha a tela do Stripe com você.

**Regras de ouro:**
1. **Comece SEMPRE em modo _test_.** No topo do Dashboard existe um toggle
   "Test mode". Confirme que está LIGADO antes de qualquer passo. Só migramos para
   _live_ depois que o fluxo inteiro for validado.
2. **Não invente caminhos de menu.** Se um item não estiver onde o guia diz (o
   Stripe muda a UI com frequência), use a **busca do Dashboard** (atalho `/` ou a
   lupa no topo) digitando o nome do recurso (ex.: "Connect settings", "Webhooks",
   "Branding"). Descreva o que você vê e peça confirmação antes de mudar algo.
3. **Nunca peça nem exiba a chave secreta (`sk_...`) em texto aberto** se não for
   necessário. Quando um valor precisar ser copiado (ex.: signing secret do webhook),
   instrua o usuário a **copiar e colar direto no arquivo `.env`**, e apenas confirme
   "copiado" — não repita o segredo na conversa.
4. **Valores a devolver ao usuário no final** (ver seção 3, checklist): o
   `STRIPE_CONNECT_WEBHOOK_SECRET`. As demais chaves (`STRIPE_SECRET_KEY`) já existem
   no projeto por causa do billing.
5. **Não altere nada relacionado a "Billing", "Subscriptions", "Products" ou
   "Prices".** Isso é do outro subsistema (assinatura do SaaS) e não pode ser tocado.
   Você só mexe em **Connect**, **Branding do Connect** e **Webhooks (do Connect)**.
6. Se algo divergir do esperado (país da conta não-BR, Connect indisponível,
   capability Pix bloqueada), **pare e avise o usuário** — pode exigir decisão dele.

---

## 1. Contexto do produto e da arquitetura (por que estamos fazendo isso)

**Minha Church** é um SaaS de gestão para igrejas. Ele tem **dois relacionamentos
com o Stripe que são totalmente separados e não se misturam:**

| Subsistema | Quem a igreja é no Stripe | Para quê | Status |
|---|---|---|---|
| **Billing (assinatura do SaaS)** | um **Customer** da plataforma | a igreja paga o Minha Church | **Já existe. NÃO MEXER.** |
| **Recebimentos (Connect)** | uma **Connected Account (Express)** | a igreja **recebe** dízimos e doações dos membros | **Giving + onboarding já no código; este guia configura o Dashboard.** |

**Decisões de arquitetura que explicam a configuração:**
- **A igreja é a _merchant of record_ (MoR).** O dinheiro cai na conta conectada da
  própria igreja; a responsabilidade fiscal/NF e disputas são dela. Por isso usamos
  contas **Express** (o Stripe hospeda o onboarding e faz o KYC/verificação segundo
  as regras do Brasil).
- **Cobrança vigente: direct charge** na conta conectada (`Stripe-Account: acct_...`)
  com `application_fee_amount` opcional. Ver `payments-decisions.md` §3–4. A capability
  **`transfers`** continua sendo solicitada; Pix **não** é pedida via API em Express BR
  (a igreja liga no Express Dashboard ou via default da plataforma).
- **Giving já implementado:** fundos, checkout (membro + público `/doar`), webhooks de
  `payment_intent.*` e painel de contribuições. O onboarding continua dependendo do
  webhook Connect para sincronizar `charges_enabled`.
- **O estado da conta é lido do nosso banco**, sincronizado por **webhook**. Por isso
  o webhook do Connect (passo 2.5) é essencial — sem ele, o app não sabe quando a
  conta foi aprovada.
- **Taxa da plataforma = 0% no lançamento** (`PAYMENTS_PLATFORM_FEE_BPS=0`). O
  mecanismo já está pronto e liga depois sem migração.

Fluxo de fundos (vigente — direct charge):

```
Membro paga (Pix/cartão/boleto)
        │
        ▼
PaymentIntent criado NA CONTA CONECTADA (igreja = MoR)
        │
        ├─ application_fee_amount ──► Conta Minha Church (taxa; 0 no lançamento)
        └─ restante ──────────────────► Saldo da conta Express da igreja
```

---

## 2. Contrato técnico — o que o backend JÁ espera do Stripe

O código do backend (`minha-church-be`, módulo `payments`) já está implementado. Ele
depende de o Stripe estar configurado exatamente assim:

- **API que o backend chama:** `accounts.create` (tipo `express`, país `BR`),
  `accountLinks.create` (tipo `account_onboarding`), `accounts.retrieve`.
- **Capabilities solicitadas na criação da conta** (env
  `PAYMENTS_ENABLED_METHODS=pix,card,boleto`): `card_payments`, `boleto_payments`
  e sempre `transfers`. `pix` na env representa intenção de produto, mas **não** é
  pedida via API (limitação Express BR — ver `payments-decisions.md` §2).
- **Webhook DEDICADO do Connect** que o backend expõe:
  `POST /api/v1/payments/connect/webhook`
  - Escuta eventos **de contas conectadas** (não da conta da plataforma).
  - Eventos mínimos: **`account.updated`**, **`capability.updated`**, e os de
    giving (`payment_intent.succeeded`, `payment_intent.payment_failed`,
    `payment_intent.canceled`, mais estornos quando habilitados).
  - Precisa de um **signing secret PRÓPRIO** → env `STRIPE_CONNECT_WEBHOOK_SECRET`
    (é **diferente** do `STRIPE_WEBHOOK_SECRET` usado pelo billing).
- **Envs relevantes** (arquivo `minha-church-be/.env`):
  ```bash
  STRIPE_SECRET_KEY=sk_test_...            # já existe (billing usa a mesma conta)
  STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...  # NOVO — sai do passo 2.5
  PAYMENTS_PLATFORM_FEE_BPS=0              # taxa da plataforma (0 no lançamento)
  PAYMENTS_ENABLED_METHODS=pix,card,boleto # capabilities pedidas
  ```
- **Como o usuário aciona o fluxo no app** (para o teste do passo 3):
  Painel do Minha Church → **Configurações → Recebimentos → "Ativar recebimentos"**
  (visível só para o proprietário da igreja). Isso cria a conta Express e redireciona
  para o onboarding hospedado do Stripe. Ao voltar, o app sincroniza o estado.

---

## 3. Passo a passo no Stripe Dashboard (instruções navegáveis)

> Faça tudo em **modo test** primeiro (seção 0, regra 1).

### Passo 2.1 — Confirmar que a conta-plataforma é do Brasil
- **Onde:** topo esquerdo do Dashboard, clique no nome da conta → veja o país.
- **O que procurar:** país = **Brasil**; moeda padrão = **BRL**.
- **Por quê:** define a liquidação em reais e a disponibilidade de **Pix** e
  **boleto**. Se a capability Pix depender de país/elegibilidade, é aqui que se
  origina.
- **Se não for BR:** PARE e avise o usuário — a estratégia de recebimentos em BRL
  com Pix/boleto muda completamente.

### Passo 2.2 — Ativar o Connect + preencher o perfil da plataforma
- **Onde:** menu lateral **Connect** (ou busque "Connect"). Se aparecer "Get
  started", clique. Depois **Settings → Connect** para o perfil da plataforma.
- **O que fazer:** ativar o Connect e preencher o **Platform profile** (o que a
  plataforma faz, site/URL, setor). Setor sugerido: software / SaaS para
  organizações religiosas. Descrição: "Plataforma de gestão para igrejas que
  permite que cada igreja receba dízimos e doações."
- **Por quê:** sem o Connect ativado, `accounts.create` falha. O perfil é
  obrigatório para plataformas e o Stripe usa isso para avaliar risco.

### Passo 2.3 — Configurar as contas Express (branding + capabilities)
- **Onde:** **Connect → Settings** (procure seções "Branding" e/ou "Express").
- **O que fazer:**
  - **Branding:** definir nome de exibição "Minha Church", logo e cor. Isso aparece
    na tela de onboarding hospedada que a igreja vê.
  - **Capabilities / payment methods:** confirmar que **cartão**, **Pix** e
    **boleto** estão disponíveis para as contas conectadas. (O backend as solicita
    por conta; aqui garantimos que a plataforma tem acesso a elas.)
- **Por quê:** o onboarding Express é hospedado pelo Stripe — é ele quem faz KYC,
  verificação de identidade e coleta de documentos exigidos no Brasil. O branding
  faz a igreja confiar na tela ("Minha Church").
- **Se Pix aparecer indisponível/bloqueado:** avise o usuário. Dá para lançar só com
  cartão+boleto mudando `PAYMENTS_ENABLED_METHODS=card,boleto` no `.env` (sem mudar
  código) e habilitar Pix depois.

### Passo 2.4 — Entender e aceitar a _liability_ do Express (DECISÃO DE NEGÓCIO)
- **O que é:** em contas **Express**, a **plataforma (Minha Church)** é responsável,
  perante o Stripe, por **saldos negativos, estornos e disputas** das contas
  conectadas quando a conta da igreja não tiver saldo para cobrir.
- **Cenário concreto:** igreja recebe, saca o dinheiro, e depois o pagador abre uma
  disputa/estorno. O Stripe debita a conta da igreja; se não houver saldo, **a
  plataforma cobre**.
- **O que a IA deve fazer:** **NÃO decidir sozinha.** Explique isso claramente ao
  usuário e peça confirmação verbal de que ele entende e aceita antes de prosseguir.
  Não há um botão único aqui — a aceitação acontece ao ativar os termos do Connect.
- **Mitigações:** priorizar **Pix** (sem chargeback "forçado" como cartão); avaliar
  cartão com calma; reservas/payout schedule podem ser configurados nas próximas
  fases.

### Passo 2.5 — Criar o webhook do Connect e copiar o signing secret ⭐ (crítico)
- **Onde:** **Developers → Webhooks → Add endpoint** (ou busque "Webhooks").
- **O que preencher:**
  - **Endpoint URL:**
    - Produção/staging: `https://<sua-api>/api/v1/payments/connect/webhook`
    - (O `<sua-api>` é o domínio do backend `minha-church-be`; peça ao usuário.)
  - **IMPORTANTE — marcar "Listen to events on Connected accounts"** (ou similar:
    "Events from connected accounts"). É isto que diferencia do webhook do billing.
    Se você criar um webhook "normal" (só da conta da plataforma), o app **não**
    receberá as atualizações das contas das igrejas.
  - **Eventos a selecionar:** `account.updated` e `capability.updated`.
- **Depois de criar:** abra o endpoint, encontre **"Signing secret"** (começa com
  `whsec_...`), revele e copie.
- **Onde colar:** no arquivo `minha-church-be/.env`, na variável
  **`STRIPE_CONNECT_WEBHOOK_SECRET`**. Confirme com o usuário que colou (não repita
  o valor na conversa).
- **Por quê:** o app lê o estado da conta do banco, atualizado por este webhook.
  O secret é próprio e separado do billing de propósito (não misturar assinatura
  SaaS com recebimentos).

**Ambiente local (dev), alternativa ao endpoint público:** o usuário pode rodar o
Stripe CLI em vez de um webhook público:
```bash
stripe listen --forward-connect-to localhost:3001/api/v1/payments/connect/webhook
```
(Em versões do CLI pode ser `stripe listen --connect --forward-to ...`.) O CLI
imprime um `whsec_...` — esse vira o `STRIPE_CONNECT_WEBHOOK_SECRET` **local** (é
diferente do secret do endpoint público).

### Passo 2.6 — Versão da API (só ler, provavelmente nada a fazer)
- **Contexto:** o **Pix** exige uma versão de API recente. O SDK do backend
  (`stripe@^22`) já fixa uma versão recente e o código **não força** `apiVersion`
  (para não arriscar regressão no billing).
- **O que a IA deve fazer:** normalmente **nada**. Só se a criação de conta falhar
  citando versão/Pix, avisar o usuário — nesse caso decidimos juntos entre fixar
  versão (testando o billing junto) ou desabilitar Pix temporariamente via env.

### Passo 2.7 — Testar de ponta a ponta (modo test)
1. Garanta as envs preenchidas (seção 2) com chaves **de teste**; reinicie o backend.
2. No app (como **proprietário** da igreja): **Configurações → Recebimentos →
   "Ativar recebimentos"**. Deve redirecionar para o onboarding hospedado do Stripe.
3. No onboarding, use o botão **"usar dados de teste"** do Stripe para preencher
   rápido.
4. Ao voltar para o app (URL com `?connect=return`), o Minha Church dispara um
   **sync** e o card de Recebimentos deve mudar de estado (ex.: "Em verificação" ou
   "Ativo").
5. Confira no Dashboard (modo test) → **Connect → Accounts** que a conta apareceu, e
   em **Webhooks** que os eventos `account.updated` chegaram com status 200.

---

## 4. Checklist final (o que a IA valida com o usuário)

- [ ] Modo **test** ligado durante toda a configuração
- [ ] Conta-plataforma é **Brasil / BRL**
- [ ] **Connect ativado** + platform profile preenchido
- [ ] **Express** configurado (branding "Minha Church" + cartão/Pix/boleto disponíveis)
- [ ] **Liability do Express** explicada e aceita pelo usuário
- [ ] **Webhook do Connect** criado com "eventos de contas conectadas" +
      `account.updated` e `capability.updated`
- [ ] `STRIPE_CONNECT_WEBHOOK_SECRET` copiado para `minha-church-be/.env`
- [ ] Demais envs conferidas (`STRIPE_SECRET_KEY` já existente,
      `PAYMENTS_PLATFORM_FEE_BPS=0`, `PAYMENTS_ENABLED_METHODS=pix,card,boleto`)
- [ ] Fluxo testado de ponta a ponta em modo test (conta criada + webhook 200)

**Valor que a IA deve garantir que o usuário guardou:** o `whsec_...` do webhook do
Connect no `.env` como `STRIPE_CONNECT_WEBHOOK_SECRET`. Sem ele, o app não recebe as
atualizações de status das contas das igrejas.
