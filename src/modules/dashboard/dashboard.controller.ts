import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('churches/:churchId/dashboard')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.dashboard_access)
  getSummary(@Param('churchId') churchId: string) {
    return this.dashboardService.getSummary(churchId);
  }
}
