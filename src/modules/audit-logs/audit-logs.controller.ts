import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ChurchAccessGuard,
  PermissionsGuard,
} from '../../common/guards';
import { AuditService } from '../../common/services/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.dto';

@Controller('churches/:churchId/audit-logs')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, PermissionsGuard)
@RequirePermission(ChurchPermission.settings_access)
export class AuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(
    @Param('churchId') churchId: string,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    return this.auditService.findPage(churchId, {
      cursor: query.cursor,
      limit: query.limit,
      action: query.action,
    });
  }
}
