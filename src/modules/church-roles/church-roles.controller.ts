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
import { ChurchAccessGuard, PermissionsGuard, TrialWriteGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import {
  CreateChurchRoleDto,
  UpdateChurchRoleDto,
} from './dto/church-role.dto';
import { ChurchRolesService } from './church-roles.service';

@Controller('churches/:churchId/roles')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, PermissionsGuard, TrialWriteGuard)
@RequirePermission(ChurchPermission.roles_manage)
export class ChurchRolesController {
  constructor(private readonly churchRolesService: ChurchRolesService) {}

  @Get()
  findAll(@Param('churchId') churchId: string) {
    return this.churchRolesService.findAll(churchId);
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreateChurchRoleDto,
  ) {
    return this.churchRolesService.create(churchId, actor.sub, dto);
  }

  @Patch(':roleId')
  update(
    @Param('churchId') churchId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: UpdateChurchRoleDto,
  ) {
    return this.churchRolesService.update(churchId, roleId, actor.sub, dto);
  }

  @Delete(':roleId')
  @HttpCode(204)
  async remove(
    @Param('churchId') churchId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    await this.churchRolesService.remove(churchId, roleId, actor.sub);
  }
}
