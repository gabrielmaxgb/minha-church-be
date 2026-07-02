import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { ChurchMembershipsService } from './church-memberships.service';

@Controller('churches/:churchId/memberships')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, PermissionsGuard)
@RequirePermission(ChurchPermission.memberships_manage)
export class ChurchMembershipsController {
  constructor(
    private readonly churchMembershipsService: ChurchMembershipsService,
  ) {}

  @Get()
  findAll(@Param('churchId') churchId: string) {
    return this.churchMembershipsService.findAll(churchId);
  }

  @Get('assignable-roles')
  findAssignableRoles(
    @Param('churchId') churchId: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.churchMembershipsService.findAssignableRoles(
      churchId,
      actor.sub,
    );
  }

  @Get('pending-access')
  findPendingAccess(@Param('churchId') churchId: string) {
    return this.churchMembershipsService.findPendingAccessUsers(churchId);
  }

  @Get('password-reset-requests')
  findPasswordResetRequests(@Param('churchId') churchId: string) {
    return this.churchMembershipsService.findPasswordResetRequests(churchId);
  }

  @Post(':userId/reset-password')
  resetMemberPassword(
    @Param('churchId') churchId: string,
    @Param('userId') userId: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.churchMembershipsService.resetMemberPassword(
      churchId,
      userId,
      actor.sub,
    );
  }

  @Patch(':userId')
  updateMembership(
    @Param('churchId') churchId: string,
    @Param('userId') userId: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.churchMembershipsService.updateMembership(
      churchId,
      userId,
      actor.sub,
      dto,
    );
  }
}
