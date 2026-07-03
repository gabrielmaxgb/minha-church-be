import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ChurchAccessGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateChurchEventDto,
  DeleteChurchEventQueryDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
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

  @Get(':eventId')
  findOne(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.findOne(churchId, eventId);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChurchEventDto,
  ) {
    return this.eventsService.create(churchId, user.sub, dto);
  }

  @Patch(':eventId')
  update(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateChurchEventDto,
  ) {
    return this.eventsService.update(churchId, eventId, user.sub, dto);
  }

  @Delete(':eventId')
  @HttpCode(204)
  async remove(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: DeleteChurchEventQueryDto,
  ) {
    await this.eventsService.remove(churchId, eventId, user.sub, query.scope);
  }
}
