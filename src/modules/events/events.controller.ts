import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateChurchEventDto,
  ListChurchEventsQueryDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

@Controller('churches/:churchId/events')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findAll(
    @Param('churchId') churchId: string,
    @Query() query: ListChurchEventsQueryDto,
  ) {
    return this.eventsService.findAll(churchId, query);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChurchEventDto,
  ) {
    return this.eventsService.create(churchId, user.sub, dto);
  }
}
