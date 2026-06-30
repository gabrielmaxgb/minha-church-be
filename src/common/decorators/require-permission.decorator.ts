import { SetMetadata } from '@nestjs/common';
import type { ChurchPermission } from '@prisma/client';

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermission = (...permissions: ChurchPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
