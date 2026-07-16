import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('churches/:churchId/notifications')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.listForUser(churchId, user.sub);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @Param('churchId') churchId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notificationsService.markRead(churchId, id, user.sub);
  }
}
