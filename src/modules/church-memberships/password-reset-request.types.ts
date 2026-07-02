export interface PasswordResetRequestResponse {
  id: string;
  userId: string;
  name: string;
  login: string;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  createdAt: string;
}

export interface ResetMemberPasswordResponse {
  userId: string;
  name: string;
  login: string;
  email: string | null;
  cpf: string | null;
  temporaryPassword: string;
}
