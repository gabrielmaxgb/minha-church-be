import { createHmac, timingSafeEqual } from 'node:crypto';

/** 2 anos — visitante precisa achar o link depois. */
const MANAGE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;

/**
 * Token opaco para gerenciar contribuição mensal pública.
 * Formato: `{exp}.{sig}` (base64url), amarrado ao subscriptionId.
 */
export function createGivingSubscriptionManageToken(
  subscriptionId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + MANAGE_TOKEN_TTL_SECONDS;
  const sig = signManagePayload(subscriptionId, exp, secret);
  return `${exp}.${sig}`;
}

export function verifyGivingSubscriptionManageToken(
  subscriptionId: string,
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!token?.trim()) {
    return false;
  }

  const [expRaw, sig] = token.trim().split('.');
  if (!expRaw || !sig) {
    return false;
  }

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < nowSeconds) {
    return false;
  }

  const expected = signManagePayload(subscriptionId, exp, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(sig);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}

function signManagePayload(
  subscriptionId: string,
  exp: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`giving-sub-manage:${subscriptionId}.${exp}`)
    .digest('base64url');
}
