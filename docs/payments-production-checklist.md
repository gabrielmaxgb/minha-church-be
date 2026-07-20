# Checklist de produção — Recebimentos (P7)

Faça isto **por último**, depois de validar o fluxo em test mode. Não bloqueia features: é operacional.

## 1. Railway (backend)

Espelhar envs de [`minha-church-be/.env.example`](../.env.example) no serviço Railway de produção:

- `STRIPE_SECRET_KEY` — `sk_live_...`
- `STRIPE_PUBLISHABLE_KEY` / equivalente FE `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_CONNECT_WEBHOOK_SECRET` — signing secret do endpoint Connect **live**
- `STRIPE_WEBHOOK_SECRET` — billing SaaS (não misturar com Connect)
- `PAYMENTS_PLATFORM_FEE_BPS` — taxa da plataforma (hoje `0`)
- `PAYMENTS_ENABLED_METHODS` — ex. `pix,card,boleto`
- URLs públicas do app (`FRONTEND_URL` / CORS) apontando para o domínio live
- `DATABASE_URL` de produção + `prisma migrate deploy`

## 2. Stripe Dashboard (live)

1. Toggle **Test mode OFF**.
2. **Connect → Settings**: branding, platform profile, Payment methods (Pix on by default quando elegível — ver `payments-decisions.md` §2).
3. **Developers → Webhooks**: endpoint  
   `https://<api-prod>/api/v1/payments/connect/webhook`  
   Events mínimos:
   - `account.updated`, `capability.updated`
   - `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`
   - `charge.refunded`, `refund.updated`
   - `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copiar o signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Confirmar que “Issue refunds” / payments features permanecem habilitadas para contas conectadas (`payments-decisions.md` §3).

## 2b. Pix — pós-invite (só depois do Support liberar)

Pré-requisito: case em [`pix-access-request.md`](./pix-access-request.md) aprovado / `pix_payments` presente na plataforma.

1. **Settings → Payment methods** → Pix → **On by default** (Connect Express).
2. Confirmar na API/Dashboard: plataforma e contas Express com Pix elegível
   (`pix_payments` active quando aplicável).
3. Sync Connect no app (owner) → `pixStatus === active` no status da igreja.
4. Fundo com `allowPix: true` → checkout público/membro mostra Pix.
5. Smoke E2E: doação one-shot Pix → `succeeded` (QR / copia-e-cola).
6. Não misturar com Custom Payment Method / PicPay neste passo.

## 3. Frontend (Vercel ou host)

- `NEXT_PUBLIC_API_URL` → API de produção
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_live_...`

## 4. Smoke E2E real (igreja teste)

1. Owner completa perfil fiscal + onboarding Connect live.
2. Cria fundo público + fundo members.
3. Doação one-shot (cartão/Pix) → status `succeeded` no painel.
4. Estorno pelo painel → status `refunded`.
5. Export CSV de contribuições.
6. Lançamento manual de saída + resumo do mês.
7. (Opcional) Contribuição mensal + cancelamento.
8. (Opcional) Evento com `priceCents` → pagar inscrição.

## 5. Monitoramento

- Alertas/logs de falha no webhook Connect (Railway logs / Axiom / similar).
- Taxa de erro HTTP no serviço `payments` nas primeiras 48h.
