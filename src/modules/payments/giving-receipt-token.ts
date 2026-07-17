import { createHmac, timingSafeEqual } from 'node:crypto';

const RECEIPT_TOKEN_TTL_SECONDS = 60 * 60 * 48; // 48h — cobre Pix/boleto pendente

/**
 * Token opaco para recibo público: expira e é amarrado ao donationId.
 * Formato: `{exp}.{sig}` (base64url).
 */
export function createGivingReceiptToken(
  donationId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + RECEIPT_TOKEN_TTL_SECONDS;
  const sig = signReceiptPayload(donationId, exp, secret);
  return `${exp}.${sig}`;
}

export function verifyGivingReceiptToken(
  donationId: string,
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

  const expected = signReceiptPayload(donationId, exp, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(sig);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}

function signReceiptPayload(
  donationId: string,
  exp: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${donationId}.${exp}`)
    .digest('base64url');
}
