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

import { Roles } from '../../common/decorators/roles.decorator';
import {
  CHURCH_MEMBER_MANAGER_ROLES,
  ChurchAccessGuard,
  RolesGuard,
} from '../../common/guards';
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
  findAll(
    @Param('churchId') churchId: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.membersService.findAll(churchId, query);
  }

  @Get(':memberId')
  findOne(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.findOne(churchId, memberId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  create(@Param('churchId') churchId: string, @Body() dto: CreateMemberDto) {
    return this.membersService.create(churchId, dto);
  }

  @Patch(':memberId')
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  update(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.membersService.update(churchId, memberId, dto);
  }

  @Delete(':memberId')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  async remove(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    await this.membersService.remove(churchId, memberId);
  }

  @Post(':memberId/receive')
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  receive(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.receive(churchId, memberId);
  }

  @Post(':memberId/ministries')
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  assignMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Body() dto: AssignMemberMinistryDto,
  ) {
    return this.membersService.assignMinistry(churchId, memberId, dto);
  }

  @Delete(':memberId/ministries/:ministryId')
  @UseGuards(RolesGuard)
  @Roles(...CHURCH_MEMBER_MANAGER_ROLES)
  removeMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Param('ministryId') ministryId: string,
  ) {
    return this.membersService.removeMinistry(churchId, memberId, ministryId);
  }
}
