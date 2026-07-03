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
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateMinistryDto,
  CreateMinistryEventDto,
  CreateMinistryRoleDto,
  DeleteMinistryEventQueryDto,
  ListMinistryEventsQueryDto,
  UpdateMinistryDto,
  UpdateMinistryEventDto,
  UpdateMinistryRoleDto,
} from './dto/ministry.dto';
import { MinistriesService } from './ministries.service';

@Controller('churches/:churchId/ministries')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class MinistriesController {
  constructor(private readonly ministriesService: MinistriesService) {}

  @Get()
  findAll(@Param('churchId') churchId: string) {
    return this.ministriesService.findAll(churchId);
  }

  @Get(':ministryId')
  findOne(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
  ) {
    return this.ministriesService.findOne(churchId, ministryId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  create(@Param('churchId') churchId: string, @Body() dto: CreateMinistryDto) {
    return this.ministriesService.create(churchId, dto);
  }

  @Patch(':ministryId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  update(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Body() dto: UpdateMinistryDto,
  ) {
    return this.ministriesService.update(churchId, ministryId, dto);
  }

  @Delete(':ministryId')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  async remove(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
  ) {
    await this.ministriesService.remove(churchId, ministryId);
  }

  @Get(':ministryId/roles')
  listRoles(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
  ) {
    return this.ministriesService.listRoles(churchId, ministryId);
  }

  @Post(':ministryId/roles')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  createRole(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Body() dto: CreateMinistryRoleDto,
  ) {
    return this.ministriesService.createRole(churchId, ministryId, dto);
  }

  @Patch(':ministryId/roles/:roleId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  updateRole(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateMinistryRoleDto,
  ) {
    return this.ministriesService.updateRole(churchId, ministryId, roleId, dto);
  }

  @Delete(':ministryId/roles/:roleId')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.ministries_manage)
  async removeRole(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.ministriesService.removeRole(churchId, ministryId, roleId);
  }

  @Get(':ministryId/members')
  listMembers(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
  ) {
    return this.ministriesService.listMembers(churchId, ministryId);
  }

  @Get(':ministryId/events')
  listEvents(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Query() query: ListMinistryEventsQueryDto,
  ) {
    return this.ministriesService.listEvents(churchId, ministryId, query);
  }

  @Post(':ministryId/events')
  createEvent(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMinistryEventDto,
  ) {
    return this.ministriesService.createEvent(
      churchId,
      ministryId,
      user.sub,
      dto,
    );
  }

  @Patch(':ministryId/events/:eventId')
  updateEvent(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMinistryEventDto,
  ) {
    return this.ministriesService.updateEvent(
      churchId,
      ministryId,
      eventId,
      user.sub,
      dto,
    );
  }

  @Delete(':ministryId/events/:eventId')
  @HttpCode(204)
  async removeEvent(
    @Param('churchId') churchId: string,
    @Param('ministryId') ministryId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: DeleteMinistryEventQueryDto,
  ) {
    await this.ministriesService.removeEvent(
      churchId,
      ministryId,
      eventId,
      user.sub,
      query.scope,
    );
  }
}
