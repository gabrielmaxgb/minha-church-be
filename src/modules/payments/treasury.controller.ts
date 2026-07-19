import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import {
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
} from './dto/finance-account.dto';
import {
  CloseFinancialPeriodDto,
  ReopenFinancialPeriodDto,
} from './dto/financial-period.dto';
import { TreasuryService } from './treasury.service';

@Controller('churches/:churchId/treasury')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('accounts')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  listAccounts(
    @Param('churchId') churchId: string,
    @Query('kind') kind?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.treasury.listAccounts(churchId, {
      kind,
      includeInactive:
        includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Post('accounts')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  createAccount(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFinanceAccountDto,
  ) {
    return this.treasury.createAccount(churchId, user.sub, dto);
  }

  @Patch('accounts/:accountId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  updateAccount(
    @Param('churchId') churchId: string,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateFinanceAccountDto,
  ) {
    return this.treasury.updateAccount(churchId, accountId, dto);
  }

  @Get('periods/status')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
    ChurchPermission.reports_access,
  )
  getPeriodStatus(
    @Param('churchId') churchId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    const y = year ? Number(year) : now.getUTCFullYear();
    const m = month ? Number(month) : now.getUTCMonth() + 1;
    return this.treasury.getPeriodStatus(churchId, y, m);
  }

  @Get('periods')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
    ChurchPermission.reports_access,
  )
  listClosedPeriods(
    @Param('churchId') churchId: string,
    @Query('year') year?: string,
  ) {
    return this.treasury.listClosedPeriods(churchId, {
      year: year ? Number(year) : undefined,
    });
  }

  @Post('periods/close')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  closePeriod(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CloseFinancialPeriodDto,
  ) {
    return this.treasury.closePeriod(churchId, user.sub, dto);
  }

  @Post('periods/reopen')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  reopenPeriod(
    @Param('churchId') churchId: string,
    @Body() dto: ReopenFinancialPeriodDto,
  ) {
    return this.treasury.reopenPeriod(churchId, dto);
  }

  @Get('report')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.reports_access,
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  getFinancialReport(
    @Param('churchId') churchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.treasury.getFinancialReport(churchId, { from, to });
  }

  @Get('report/export')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.reports_access,
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="relatorio-financeiro.csv"',
  )
  exportFinancialReport(
    @Param('churchId') churchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.treasury.exportFinancialReportCsv(churchId, { from, to });
  }
}
