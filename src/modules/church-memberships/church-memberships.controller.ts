import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';
import {
  CHURCH_MEMBERSHIP_MANAGER_ROLES,
  ChurchAccessGuard,
  RolesGuard,
} from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { UsersService } from '../users/users.service';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { ChurchMembershipsService } from './church-memberships.service';

@Controller('churches/:churchId/memberships')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, RolesGuard)
@Roles(...CHURCH_MEMBERSHIP_MANAGER_ROLES)
export class ChurchMembershipsController {
  constructor(
    private readonly churchMembershipsService: ChurchMembershipsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  findAll(@Param('churchId') churchId: string) {
    return this.churchMembershipsService.findAll(churchId);
  }

  @Patch(':userId')
  async updateRole(
    @Param('churchId') churchId: string,
    @Param('userId') userId: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: UpdateMembershipDto,
  ) {
    const actorRole = await this.usersService.getRoleInChurch(
      actor.sub,
      churchId,
    );

    if (!actorRole) {
      throw new ForbiddenException('Sem acesso a esta igreja.');
    }

    return this.churchMembershipsService.updateRole(
      churchId,
      userId,
      actor.sub,
      actorRole,
      dto,
    );
  }
}
