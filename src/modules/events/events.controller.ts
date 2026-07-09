import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard, TrialWriteGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateChurchEventDto,
  DeleteChurchEventQueryDto,
  ListChurchEventsQueryDto,
  UpdateChurchEventDto,
  UpdateEventRosterCollectionDto,
  UpsertEventRosterDto,
} from './dto/event.dto';
import { UpdateEventAvailabilityDto } from '../ministries/dto/ministry.dto';
import { EventsService } from './events.service';

@Controller('churches/:churchId/events')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, TrialWriteGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.activities_access,
    ChurchPermission.events_create_church_wide,
  )
  findAll(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListChurchEventsQueryDto,
  ) {
    return this.eventsService.findAll(churchId, user.sub, query);
  }

  @Get('series/:seriesId/occurrences')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.activities_access,
    ChurchPermission.events_create_church_wide,
  )
  listSeriesOccurrences(
    @Param('churchId') churchId: string,
    @Param('seriesId') seriesId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eventsService.listSeriesOccurrences(
      churchId,
      seriesId,
      user.sub,
    );
  }

  @Get(':eventId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.activities_access,
    ChurchPermission.events_create_church_wide,
  )
  findOne(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eventsService.findOne(churchId, eventId, user.sub);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChurchEventDto,
  ) {
    return this.eventsService.create(churchId, user.sub, dto);
  }

  @Put(':eventId/roster')
  upsertRoster(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertEventRosterDto,
  ) {
    return this.eventsService.upsertRosterAssignment(
      churchId,
      eventId,
      user.sub,
      dto,
    );
  }

  @Patch(':eventId/availability')
  @HttpCode(204)
  async updateMyAvailability(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEventAvailabilityDto,
  ): Promise<void> {
    await this.eventsService.updateMyAvailability(
      churchId,
      eventId,
      user.sub,
      dto,
    );
  }

  @Delete(':eventId/roster/:memberId')
  removeRoster(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eventsService.removeRosterAssignment(
      churchId,
      eventId,
      memberId,
      user.sub,
    );
  }

  @Patch(':eventId/roster-collection')
  setRosterCollection(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEventRosterCollectionDto,
  ) {
    return this.eventsService.setRosterCollection(
      churchId,
      eventId,
      user.sub,
      dto,
    );
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
