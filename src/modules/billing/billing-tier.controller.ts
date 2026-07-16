import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';
import type { Response } from 'express';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { ChurchOwnerGuard } from '../../common/guards/church-owner.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { BillingService } from './billing.service';
import { ConfirmTierCrossingDto } from './dto/confirm-tier-crossing.dto';
import { Throttle } from '@nestjs/throttler';
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
  @UseGuards(ChurchOwnerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  @Post('tier-crossing/request')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  requestTierCrossing(
    @Param('churchId') churchId: string,
    @Body() dto: ConfirmTierCrossingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.requestTierCrossing(
      churchId,
      user.sub,
      dto.targetTierId,
    );
  }

  @Get('tier-crossing/pending')
  async getPendingTierCrossing(
    @Param('churchId') churchId: string,
    @Res() res: Response,
  ) {
    const pending =
      await this.billingService.getPendingTierCrossingRequest(churchId);

    return res.status(200).json(pending);
  }

  @Post('tier-crossing/approve')
  @UseGuards(ChurchOwnerGuard)
  approveTierCrossing(
    @Param('churchId') churchId: string,
    @Body() dto: ConfirmTierCrossingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.approveTierCrossingRequest(
      churchId,
      user.sub,
      dto.targetTierId,
    );
  }

  @Post('tier-crossing/dismiss')
  @UseGuards(ChurchOwnerGuard)
  dismissTierCrossing(
    @Param('churchId') churchId: string,
    @Body() dto: ConfirmTierCrossingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.dismissTierCrossingRequest(
      churchId,
      user.sub,
      dto.targetTierId,
    );
  }

  @Get('tier-crossing/notices')
  listStaffNotices(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.listUnreadStaffNotices(churchId, user.sub);
  }

  @Post('tier-crossing/notices/:noticeId/read')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  markStaffNoticeRead(
    @Param('churchId') churchId: string,
    @Param('noticeId') noticeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.billingService.markStaffNoticeRead(
      churchId,
      user.sub,
      noticeId,
    );
  }
}
