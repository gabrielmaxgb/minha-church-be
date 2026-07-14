import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { CreatePrayerRequestDto } from './dto/prayer-request.dto';
import { PrayerRequestsService } from './prayer-requests.service';

@Controller('churches/:churchId/prayer-requests')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class PrayerRequestsController {
  constructor(private readonly prayerRequestsService: PrayerRequestsService) {}

  @Get()
  list(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prayerRequestsService.list(churchId, user.sub);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePrayerRequestDto,
  ) {
    return this.prayerRequestsService.create(churchId, user.sub, dto);
  }

  @Delete(':requestId')
  remove(
    @Param('churchId') churchId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prayerRequestsService.remove(churchId, user.sub, requestId);
  }

  @Post(':requestId/pray')
  togglePray(
    @Param('churchId') churchId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prayerRequestsService.togglePray(
      churchId,
      user.sub,
      requestId,
    );
  }
}
