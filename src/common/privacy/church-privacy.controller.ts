import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';

import { ChurchAccessGuard } from '../guards';
import { ChurchOwnerGuard } from '../guards/church-owner.guard';
import { CurrentUser } from '../../modules/auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../modules/auth/auth.types';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { AccountLifecycleService } from './account-lifecycle.service';
import { DataExportService } from './data-export.service';
import { LegalAcceptanceService } from './legal-acceptance.service';

class ChurchClosureDto {
  @IsString()
  @MinLength(1)
  confirmationSlug!: string;
}

@Controller('churches/:churchId')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class ChurchPrivacyController {
  constructor(
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly dataExport: DataExportService,
    private readonly accountLifecycle: AccountLifecycleService,
  ) {}

  @Post('dpa/accept')
  @UseGuards(ChurchOwnerGuard)
  @HttpCode(200)
  acceptDpa(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.legalAcceptance.acceptDpa(churchId, user.sub);
  }

  @Get('data-export')
  @UseGuards(ChurchOwnerGuard)
  exportChurch(@Param('churchId') churchId: string) {
    return this.dataExport.exportChurchData(churchId);
  }

  @Post('closure-request')
  @UseGuards(ChurchOwnerGuard)
  @HttpCode(200)
  requestClosure(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChurchClosureDto,
  ) {
    return this.accountLifecycle.requestChurchClosure(
      churchId,
      user.sub,
      dto.confirmationSlug,
    );
  }

  @Post('closure-cancel')
  @UseGuards(ChurchOwnerGuard)
  @HttpCode(200)
  cancelClosure(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.accountLifecycle.cancelChurchClosure(churchId, user.sub);
  }
}
