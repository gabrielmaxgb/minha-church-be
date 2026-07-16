import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { CareRequestsService } from './care-requests.service';
import { CreateCareRequestDto } from './dto/care-request.dto';

@Controller('churches/:churchId/care-requests')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class CareRequestsController {
  constructor(private readonly careRequestsService: CareRequestsService) {}

  @Get('recipients')
  listRecipients(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.careRequestsService.listRecipients(churchId, user.sub);
  }

  @Get('mine')
  listMine(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.careRequestsService.listMine(churchId, user.sub);
  }

  @Get('inbox')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.counseling_receive)
  listInbox(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.careRequestsService.listInbox(churchId, user.sub);
  }

  @Get('inbox/pending-count')
  async pendingInboxCount(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.careRequestsService.pendingInboxCount(
      churchId,
      user.sub,
    );

    return { count };
  }

  @Get('mine/viewed-count')
  async viewedMineCount(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.careRequestsService.viewedMineCount(
      churchId,
      user.sub,
    );

    return { count };
  }

  @Post('mine/ack-viewed')
  ackViewedMine(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.careRequestsService.ackViewedMine(churchId, user.sub);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCareRequestDto,
  ) {
    return this.careRequestsService.create(churchId, user.sub, dto);
  }

  @Post(':requestId/view')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.counseling_receive)
  markViewed(
    @Param('churchId') churchId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.careRequestsService.markViewed(churchId, user.sub, requestId);
  }
}
