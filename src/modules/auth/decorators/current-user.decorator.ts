import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { JwtPayload } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload | null => {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload | null;
    }>();

    return request.user ?? null;
  },
);
