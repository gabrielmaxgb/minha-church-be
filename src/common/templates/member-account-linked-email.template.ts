function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface MemberAccountLinkedEmailContent {
  userName: string;
  churchName: string;
  login: string;
  appUrl: string;
}

export function buildMemberAccountLinkedEmailHtml(
  input: MemberAccountLinkedEmailContent,
): string {
  const userName = escapeHtml(input.userName);
  const churchName = escapeHtml(input.churchName);
  const login = escapeHtml(input.login);
  const appUrl = escapeHtml(input.appUrl.replace(/\/$/, ''));
  const loginUrl = `${appUrl}/entrar`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Acesso a uma nova igreja — MinhaChurch</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141413;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e8e8e3;">
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6f6f6a;text-transform:uppercase;letter-spacing:0.04em;">MinhaChurch</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Você foi adicionado a uma igreja</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${userName}. Sua conta MinhaChurch foi vinculada à <strong>${churchName}</strong>.</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Use o login <strong>${login}</strong> e a senha que você já utiliza. No painel, você pode alternar entre as igrejas às quais tem acesso.</p>
              <p style="margin:0 0 24px;">
                <a href="${loginUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Entrar no painel</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">Se você não reconhece este vínculo, entre em contato com a liderança da igreja ou ignore este e-mail.</p>
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

export function buildMemberAccountLinkedEmailText(
  input: MemberAccountLinkedEmailContent,
): string {
  return [
    `Olá, ${input.userName}.`,
    '',
    `Sua conta MinhaChurch foi vinculada à ${input.churchName}.`,
    `Use o login ${input.login} e a senha que você já utiliza.`,
    '',
    `Entrar: ${input.appUrl.replace(/\/$/, '')}/entrar`,
    '',
    'Se você não reconhece este vínculo, fale com a liderança da igreja.',
    '',
    '— MinhaChurch',
  ].join('\n');
}
