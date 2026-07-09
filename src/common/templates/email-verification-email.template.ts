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
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e8e8e4;border-radius:16px;padding:32px 28px;">
          <tr>
            <td>
              <p style="margin:0 0 8px;font-size:14px;color:#6f6f6a;">MinhaChurch</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">Confirme seu e-mail</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d3d39;">
                Olá, ${userName}! Para liberar todos os recursos da sua igreja, confirme este endereço de e-mail.
              </p>
              <a href="${verifyUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:600;">
                Confirmar e-mail
              </a>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                O link expira em 24 horas. Se você não criou uma conta, ignore este e-mail.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:12px;color:#6f6f6a;">
          <a href="${appUrl}" style="color:#6f6f6a;">${appUrl.replace(/^https?:\/\//, '')}</a>
        </p>
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
    'Confirme seu e-mail para liberar todos os recursos da sua igreja no MinhaChurch:',
    input.verifyUrl,
    '',
    'O link expira em 24 horas.',
    '',
    '— MinhaChurch',
    input.appUrl.replace(/\/$/, ''),
  ].join('\n');
}
