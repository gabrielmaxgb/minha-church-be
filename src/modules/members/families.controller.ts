import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CreateFamilyDto, CreateMemberRelationDto } from './dto/member.dto';
import { MembersService } from './members.service';

@Controller('churches/:churchId/families')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class FamiliesController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  list(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.listFamilies(churchId, user.sub);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  create(
    @Param('churchId') churchId: string,
    @Body() dto: CreateFamilyDto,
  ) {
    return this.membersService.createFamily(churchId, dto.name);
  }

  @Get(':familyId/graph')
  getGraph(
    @Param('churchId') churchId: string,
    @Param('familyId') familyId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.getFamilyGraph(churchId, familyId, user.sub);
  }

  @Post(':familyId/relations')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  createRelation(
    @Param('churchId') churchId: string,
    @Param('familyId') familyId: string,
    @Body() dto: CreateMemberRelationDto,
  ) {
    return this.membersService.createMemberRelation(churchId, familyId, dto);
  }

  @Delete(':familyId/relations/:relationId')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  async deleteRelation(
    @Param('churchId') churchId: string,
    @Param('familyId') familyId: string,
    @Param('relationId') relationId: string,
  ) {
    await this.membersService.deleteMemberRelation(
      churchId,
      familyId,
      relationId,
    );
  }
}
