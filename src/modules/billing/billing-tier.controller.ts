import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards/church-access.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { BillingService } from './billing.service';
import { ConfirmTierCrossingDto } from './dto/confirm-tier-crossing.dto';

@Controller('churches/:churchId/billing')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class BillingTierController {
  constructor(private readonly billingService: BillingService) {}

  @Get('tier-crossing/preview')
  previewTierCrossing(
    @Param('churchId') churchId: string,
    @Query('projectedMemberCount') projectedMemberCount: string | undefined,
  ) {
    const parsed = Number(projectedMemberCount);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('projectedMemberCount é obrigatório.');
    }

    return this.billingService.previewTierCrossing(churchId, Math.trunc(parsed));
  }

  @Post('tier-crossing/confirm')
  confirmTierCrossing(
    @Param('churchId') churchId: string,
    @Body() dto: ConfirmTierCrossingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.confirmTierCrossing(
      churchId,
      user.sub,
      dto.targetTierId,
    );
  }
}
