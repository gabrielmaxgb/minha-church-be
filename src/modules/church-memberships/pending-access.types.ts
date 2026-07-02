export interface PendingAccessUserResponse {
  userId: string;
  name: string;
  login: string;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  temporaryPassword: string;
  createdAt: string;
}
