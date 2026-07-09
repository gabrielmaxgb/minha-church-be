import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AllowWhenTrialExpired } from '../../common/decorators/allow-when-trial-expired.decorator';
import { ChurchAccessGuard, PermissionsGuard, TrialWriteGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

@Controller('churches/:churchId/announcements')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, TrialWriteGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.communication_access,
    ChurchPermission.communication_manage,
  )
  list(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.listForUser(churchId, user.sub);
  }

  @Get('unread-count')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.communication_access,
    ChurchPermission.communication_manage,
  )
  async unreadCount(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.announcementsService.unreadCount(
      churchId,
      user.sub,
    );

    return { count };
  }

  @Get('manage')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.communication_manage)
  listForManagement(@Param('churchId') churchId: string) {
    return this.announcementsService.listForManagement(churchId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.communication_manage)
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcementsService.create(churchId, user.sub, dto);
  }

  @Post('read-all')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.communication_access,
    ChurchPermission.communication_manage,
  )
  @AllowWhenTrialExpired()
  async markAllRead(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.announcementsService.markAllAsRead(churchId, user.sub);
  }

  @Post(':announcementId/read')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.communication_access,
    ChurchPermission.communication_manage,
  )
  @AllowWhenTrialExpired()
  async markRead(
    @Param('churchId') churchId: string,
    @Param('announcementId') announcementId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.announcementsService.markRead(
      churchId,
      announcementId,
      user.sub,
    );
  }

  @Patch(':announcementId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.communication_manage)
  update(
    @Param('churchId') churchId: string,
    @Param('announcementId') announcementId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(churchId, announcementId, dto);
  }

  @Delete(':announcementId')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.communication_manage)
  async remove(
    @Param('churchId') churchId: string,
    @Param('announcementId') announcementId: string,
  ) {
    await this.announcementsService.remove(churchId, announcementId);
  }
}
