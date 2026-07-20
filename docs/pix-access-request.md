# Pedido de acesso Pix (Stripe BR — invite-only)

**Status (2026-07-20):** plataforma `acct_1OwBZ9AEGAbAVXnL` (MinhaChurch, BR) tem `card_payments`, `boleto_payments` e `transfers` **ativos**. **Não** tem `pix_payments`. Toggle de Pix no Dashboard permanece indisponível / Off by default.

Pix para contas Stripe **no Brasil** é **invite-only**. Não há toggle self-serve nem capability requestável via API que desbloqueie o produto na plataforma. O caminho é Support.

**Fora de escopo:** Custom Payment Method / PicPay (`cpmt_*`). Não integrar até Pix nativo estar resolvido.

## Abrir o ticket (agora)

1. Abrir: https://dashboard.stripe.com/support/create  
   (já preparado neste fluxo operacional)
2. Assunto: `Request Pix access — Brazil platform account (invite-only)`
3. Colar o texto abaixo
4. Guardar o número do case nesta seção quando o Stripe responder

### Texto para colar

```
Account ID: acct_1OwBZ9AEGAbAVXnL
Business: MinhaChurch (BR)
Country: Brazil
Product: Pix (one-time) — currently invite-only / greyed out in Payment methods

We are a Connect platform (Express connected accounts in BR) using direct charges.
We already have card_payments and boleto_payments active on the platform.
pix_payments is missing and we cannot enable Pix in Dashboard ("Off by default" / locked).

Please enable Pix eligibility for this Brazil account so we can:
1) turn Pix on by default for Connect Express accounts
2) accept Pix on connected accounts (churches collecting donations)

Urgency: blocking launch for Brazilian customers (Pix is required).
Integration is ready; we only need product access.

Notes:
- Express BR: requesting pix_payments via API returns "capability is not requestable".
- Platform MCC is 7379 (SaaS). Connected accounts are churches (religious orgs) as Merchants of Record via direct charges.
- We are NOT asking for PicPay / Custom Payment Methods — only native Stripe Pix.

Website: https://www.minhachurch.com
Contact: gmaxgomes@gmail.com
```

### Se negarem por “nonprofit / charity”

Responder reforçando:

- A **plataforma** é SaaS (MCC 7379), não ONG.
- As igrejas são **connected accounts** com **direct charges** (MoR = igreja).
- Pedir o caminho oficial para **Connect BR + Pix one-time**.

## Depois que liberarem (validação)

Ver checklist em [`payments-production-checklist.md`](./payments-production-checklist.md) §2b e decisões em [`payments-decisions.md`](./payments-decisions.md) §2.

1. Dashboard → Settings → Payment methods → Pix **On by default**.
2. Confirmar capability: plataforma e/ou contas Express com `pix_payments: active`.
3. No app: `pixStatus === active` libera Pix no checkout (já implementado).
4. Smoke: doação one-shot Pix → `succeeded`.

## Case / resposta do Stripe

| Data | Case ID | Resultado |
| --- | --- | --- |
| 2026-07-20 | _(preencher ao enviar)_ | Form Support aberto + texto pronto. API ainda sem `pix_payments`. Smoke §2b **bloqueado** até invite. |

## Validação de código (pré-invite) — OK

- Checkout só oferece Pix se `pixStatus === active` (`payments.service.ts`).
- Contas Express não pedem `pix_payments` via API (decisão §2).
- Sem referências a PicPay / `cpmt_` no código.
