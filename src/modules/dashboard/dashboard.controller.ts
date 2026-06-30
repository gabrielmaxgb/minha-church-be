import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('churches/:churchId/dashboard')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@Param('churchId') churchId: string) {
    return this.dashboardService.getSummary(churchId);
  }
}
