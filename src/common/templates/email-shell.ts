/**
 * Base visual compartilhada dos e-mails MinhaChurch.
 * Referência: password-reset (logo + card + CTA + rodapé).
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeAppUrl(appUrl: string): string {
  return appUrl.replace(/\/$/, '');
}

/**
 * Logo do header. Clientes de e-mail (Gmail etc.) não carregam localhost —
 * em local/staging privada usamos o ícone público de produção.
 */
const DEFAULT_EMAIL_LOGO_URL = 'https://www.minhachurch.com/icon.png';

export function resolveEmailLogoUrl(appUrl: string): string {
  const fromEnv = process.env.EMAIL_LOGO_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const base = normalizeAppUrl(appUrl);
  if (/localhost|127\.0\.0\.1/i.test(base)) {
    return DEFAULT_EMAIL_LOGO_URL;
  }

  return `${base}/icon.png`;
}

export interface EmailShellOptions {
  /** Título do <title> e contexto do e-mail. */
  title: string;
  /** Label pequena acima do H1 (ex.: "Contribuição mensal"). */
  eyebrow: string;
  /** Conteúdo interno do card (já escapado onde necessário). */
  bodyHtml: string;
  appUrl: string;
  /** Nota opcional no rodapé do card (acima do tagline externo). */
  cardFooterHtml?: string;
}

/** Botão primário (table-based — melhor suporte em clientes de e-mail). */
export function buildEmailCtaButton(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;">
                <tr>
                  <td style="border-radius:10px;background-color:#1a1a18;">
                    <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;text-decoration:none;color:#f4f4f1;">
                      ${safeLabel}
                    </a>
                  </td>
                </tr>
              </table>`;
}

/** Link de fallback quando o botão não abre. */
export function buildEmailFallbackLink(
  href: string,
  hint = 'Se o botão não funcionar, copie e cole este link no navegador:',
): string {
  const safeHref = escapeHtml(href);
  return `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6f6f6a;">
                ${escapeHtml(hint)}
              </p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="${safeHref}" style="color:#1a1a18;text-decoration:underline;">${safeHref}</a>
              </p>`;
}

export function buildEmailParagraph(html: string, marginBottom = 20): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-size:15px;line-height:1.6;color:#2c2c2a;">${html}</p>`;
}

export function buildEmailHeading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#141413;">${escapeHtml(text)}</h1>`;
}

export function buildEmailShell(options: EmailShellOptions): string {
  const appUrl = normalizeAppUrl(options.appUrl);
  const safeAppUrl = escapeHtml(appUrl);
  const logoUrl = escapeHtml(resolveEmailLogoUrl(appUrl));
  const displayHost = escapeHtml(appUrl.replace(/^https?:\/\//, ''));
  const eyebrow = escapeHtml(options.eyebrow);
  const title = escapeHtml(options.title);

  const cardFooter = options.cardFooterHtml
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top:1px solid #e8e8e4;padding-top:20px;">
                    ${options.cardFooterHtml}
                  </td>
                </tr>
              </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141413;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="${logoUrl}" width="36" height="36" alt="MinhaChurch" style="display:block;border-radius:10px;" />
                  </td>
                  <td style="vertical-align:middle;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#1a1a18;">
                    MinhaChurch
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;border:1px solid #d8d8d3;border-radius:14px;padding:32px 28px;box-shadow:0 4px 16px rgba(20,20,19,0.06);">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#6f6f6a;">
                ${eyebrow}
              </p>
              ${options.bodyHtml}
              ${cardFooter}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6f6f6a;">
                Gestão de igreja sem planilhas e grupos espalhados.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">
                <a href="${safeAppUrl}" style="color:#6f6f6a;text-decoration:underline;">${displayHost}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildEmailTextFooter(appUrl: string): string {
  return `— MinhaChurch\n${normalizeAppUrl(appUrl)}`;
}
