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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';
import type { Response } from 'express';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { DataExportService } from '../../common/privacy/data-export.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  AssignMemberMinistryDto,
  AckMinistryCatalogNotificationsDto,
  CreateMemberDto,
  ImportMembersDto,
  ListMembersQueryDto,
  RecordParentalConsentDto,
  UpdateMemberDto,
} from './dto/member.dto';
import { MembersService } from './members.service';

@Controller('churches/:churchId/members')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly dataExport: DataExportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findAll(
    @Param('churchId') churchId: string,
    @Query() query: ListMembersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.findAll(churchId, query, user.sub);
  }

  @Get('export')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  async exportMembers(
    @Param('churchId') churchId: string,
    @Query('format') format: string | undefined,
    @Query('includeDeleted') includeDeleted: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    let include = includeDeleted === 'true' || includeDeleted === '1';

    if (include) {
      const ownership = await this.prisma.churchMembership.findFirst({
        where: { churchId, userId: user.sub, isOwner: true },
        select: { id: true },
      });
      if (!ownership) {
        include = false;
      }
    }

    if (format === 'json') {
      return this.dataExport.exportMembersJson(churchId, {
        includeDeleted: include,
      });
    }

    const file = await this.dataExport.exportMembersCsv(churchId, {
      includeDeleted: include,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="membros.csv"',
    );
    return file;
  }

  @Get('me')
  findMine(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.findMine(user.sub, churchId);
  }

  @Get('me/export')
  exportMyMember(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dataExport.exportMyMemberData(user.sub, churchId);
  }

  @Get('me/ministry-notifications')
  findMyMinistryNotifications(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.findMyMinistryNotifications(user.sub, churchId);
  }

  @Post('me/ministry-notifications/ack-catalog')
  ackMinistryCatalogNotifications(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: AckMinistryCatalogNotificationsDto,
  ) {
    return this.membersService.ackMinistryCatalogNotifications(
      user.sub,
      churchId,
      dto.ministryIds,
    );
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

  @Post('import')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  import(@Param('churchId') churchId: string, @Body() dto: ImportMembersDto) {
    return this.membersService.importMembers(churchId, dto);
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

  @Post(':memberId/parental-consent')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  recordParentalConsent(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordParentalConsentDto,
  ) {
    return this.membersService.recordParentalConsent(
      churchId,
      memberId,
      user.sub,
      dto,
    );
  }

  @Delete(':memberId/parental-consent')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.members_manage)
  revokeParentalConsent(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.membersService.revokeParentalConsent(churchId, memberId);
  }

  @Post(':memberId/ministries')
  assignMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignMemberMinistryDto,
  ) {
    return this.membersService.assignMinistry(
      churchId,
      memberId,
      user.sub,
      dto,
    );
  }

  @Delete(':memberId/ministries/:ministryId')
  removeMinistry(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @Param('ministryId') ministryId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.membersService.removeMinistry(
      churchId,
      memberId,
      ministryId,
      user.sub,
    );
  }
}
