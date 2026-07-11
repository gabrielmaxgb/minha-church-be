function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface PasswordResetEmailContent {
  userName: string;
  resetUrl: string;
  appUrl: string;
}

export function buildPasswordResetEmailHtml(
  input: PasswordResetEmailContent,
): string {
  const userName = escapeHtml(input.userName);
  const resetUrl = escapeHtml(input.resetUrl);
  const appUrl = escapeHtml(input.appUrl.replace(/\/$/, ''));
  const logoUrl = `${appUrl}/icon.png`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Redefinir senha — MinhaChurch</title>
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
                Recuperação de senha
              </p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#141413;">
                Olá, ${userName}!
              </h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#2c2c2a;">
                Recebemos uma solicitação para redefinir a senha da sua conta no MinhaChurch.
              </p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#2c2c2a;">
                Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;">
                <tr>
                  <td style="border-radius:10px;background-color:#1a1a18;">
                    <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;text-decoration:none;color:#f4f4f1;">
                      Redefinir minha senha
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6f6f6a;">
                Se o botão não funcionar, copie e cole este link no navegador:
              </p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="${resetUrl}" style="color:#1a1a18;text-decoration:underline;">${resetUrl}</a>
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top:1px solid #e8e8e4;padding-top:20px;">
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Se você não solicitou a redefinição, ignore este e-mail. Sua senha atual continuará a mesma.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6f6f6a;">
                Gestão de igreja sem planilhas e grupos espalhados.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">
                <a href="${appUrl}" style="color:#6f6f6a;text-decoration:underline;">${appUrl.replace(/^https?:\/\//, '')}</a>
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

export function buildPasswordResetEmailText(
  input: PasswordResetEmailContent,
): string {
  return [
    `Olá, ${input.userName}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no MinhaChurch.',
    '',
    'Acesse o link abaixo para criar uma nova senha (válido por 1 hora):',
    input.resetUrl,
    '',
    'Se você não solicitou isso, ignore este e-mail.',
    '',
    '— MinhaChurch',
    input.appUrl.replace(/\/$/, ''),
  ].join('\n');
}
