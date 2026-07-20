import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Tenta autenticar via JWT (cookie / bearer), mas não falha se ausente ou inválido.
 * Usado em rotas públicas que enriquecem o fluxo quando o usuário está logado.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(
    err: Error | null,
    user: TUser,
    _info?: unknown,
  ): TUser | null {
    if (err || !user) {
      return null;
    }

    return user;
  }
}
