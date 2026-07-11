import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MinistriesService } from './ministries.service';

@Controller('churches/:churchId/roster')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class RosterController {
  constructor(private readonly ministriesService: MinistriesService) {}

  @Get('my-schedules')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.schedules_access)
  getMySchedules(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ministriesService.getMySchedules(churchId, user.sub);
  }
}
