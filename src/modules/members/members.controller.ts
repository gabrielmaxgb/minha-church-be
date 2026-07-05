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
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AssignMemberMinistryDto,
  CreateMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
} from './dto/member.dto';
import { MembersService } from './members.service';

@Controller('churches/:churchId/members')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.members_access,
    ChurchPermission.members_manage,
  )
  findAll(
    @Param('churchId') churchId: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.membersService.findAll(churchId, query);
  }

  @Get(':memberId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.members_access,
    ChurchPermission.members_manage,
  )
  findOne(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.findOne(churchId, memberId);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  create(@Param('churchId') churchId: string, @Body() dto: CreateMemberDto) {
    return this.membersService.create(churchId, dto);
  }

  @Patch(':memberId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  update(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.membersService.update(churchId, memberId, dto);
  }

  @Delete(':memberId')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  async remove(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    await this.membersService.remove(churchId, memberId);
  }

  @Post(':memberId/receive')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  receive(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.receive(churchId, memberId);
  }

  @Post(':memberId/ministries')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  assignMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Body() dto: AssignMemberMinistryDto,
  ) {
    return this.membersService.assignMinistry(churchId, memberId, dto);
  }

  @Delete(':memberId/ministries/:ministryId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  removeMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Param('ministryId') ministryId: string,
  ) {
    return this.membersService.removeMinistry(churchId, memberId, ministryId);
  }
}
