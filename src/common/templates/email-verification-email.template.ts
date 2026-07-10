function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface EmailVerificationEmailContent {
  userName: string;
  verifyUrl: string;
  appUrl: string;
}

export function buildEmailVerificationEmailHtml(
  input: EmailVerificationEmailContent,
): string {
  const userName = escapeHtml(input.userName);
  const verifyUrl = escapeHtml(input.verifyUrl);
  const appUrl = escapeHtml(input.appUrl.replace(/\/$/, ''));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Confirme seu e-mail — MinhaChurch</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141413;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e8e8e3;">
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6f6f6a;text-transform:uppercase;letter-spacing:0.04em;">MinhaChurch</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Confirme seu e-mail</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${userName}! Falta só este passo para ativar sua conta e entrar no painel.</p>
              <p style="margin:0 0 24px;">
                <a href="${verifyUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Confirmar e-mail</a>
              </p>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6f6f6a;">Ou copie e cole este link no navegador:</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;color:#141413;">${verifyUrl}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">O link expira em 24 horas. Se você não criou esta conta, ignore este e-mail.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#6f6f6a;">${appUrl}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildEmailVerificationEmailText(
  input: EmailVerificationEmailContent,
): string {
  return [
    `Olá, ${input.userName}!`,
    '',
    'Confirme seu e-mail para ativar sua conta no MinhaChurch:',
    input.verifyUrl,
    '',
    'O link expira em 24 horas.',
    '',
    '— MinhaChurch',
    input.appUrl.replace(/\/$/, ''),
  ].join('\n');
}
