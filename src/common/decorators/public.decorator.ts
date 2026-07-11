import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca rota/controller como acessível sem JWT (APP_GUARD JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
