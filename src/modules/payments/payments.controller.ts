import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Post,
  Put,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { ChurchOwnerGuard } from '../../common/guards/church-owner.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { UpsertFiscalProfileDto } from './dto/upsert-fiscal-profile.dto';
import { CreateGivingCheckoutDto } from './dto/create-giving-checkout.dto';
import { CreateMemberGivingCheckoutDto } from './dto/create-member-giving-checkout.dto';
import {
  CreateGivingFundDto,
  UpdateGivingFundDto,
} from './dto/giving-fund.dto';
import { PaymentsService } from './payments.service';

@Controller('churches/:churchId/payments')
@UseGuards(JwtAuthGuard, ChurchAccessGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('fiscal-profile')
  @UseGuards(ChurchOwnerGuard)
  getFiscalProfile(@Param('churchId') churchId: string) {
    return this.paymentsService.getFiscalProfile(churchId);
  }

  @Put('fiscal-profile')
  @UseGuards(ChurchOwnerGuard)
  upsertFiscalProfile(
    @Param('churchId') churchId: string,
    @Body() dto: UpsertFiscalProfileDto,
  ) {
    return this.paymentsService.upsertFiscalProfile(churchId, dto);
  }

  @Get('connect/status')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  getConnectStatus(@Param('churchId') churchId: string) {
    return this.paymentsService.getConnectStatus(churchId);
  }

  @Get('summary')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  getPaymentsSummary(@Param('churchId') churchId: string) {
    return this.paymentsService.getPaymentsSummary(churchId);
  }

  @Post('connect/account')
  @UseGuards(ChurchOwnerGuard)
  startConnectOnboarding(@Param('churchId') churchId: string) {
    return this.paymentsService.startConnectOnboarding(churchId);
  }

  @Post('connect/account-link')
  @UseGuards(ChurchOwnerGuard)
  createAccountLink(@Param('churchId') churchId: string) {
    return this.paymentsService.createAccountLink(churchId);
  }

  @Post('connect/sync')
  @UseGuards(ChurchOwnerGuard)
  syncConnectAccount(@Param('churchId') churchId: string) {
    return this.paymentsService.syncConnectAccount(churchId);
  }

  @Get('funds/for-members')
  listMemberGivingFunds(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.listMemberGivingFunds(churchId, user.sub);
  }

  @Get('funds')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  listGivingFunds(
    @Param('churchId') churchId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.paymentsService.listGivingFunds(churchId, {
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
  }

  @Get('donations')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  listGivingDonations(@Param('churchId') churchId: string) {
    return this.paymentsService.listGivingDonations(churchId);
  }

  @Post('funds')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  createGivingFund(
    @Param('churchId') churchId: string,
    @Body() dto: CreateGivingFundDto,
  ) {
    return this.paymentsService.createGivingFund(churchId, dto);
  }

  @Patch('funds/:fundId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  updateGivingFund(
    @Param('churchId') churchId: string,
    @Param('fundId') fundId: string,
    @Body() dto: UpdateGivingFundDto,
  ) {
    return this.paymentsService.updateGivingFund(churchId, fundId, dto);
  }

  @Delete('funds/:fundId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  deleteGivingFund(
    @Param('churchId') churchId: string,
    @Param('fundId') fundId: string,
  ) {
    return this.paymentsService.deleteGivingFund(churchId, fundId);
  }

  @Post('funds/:fundId/checkout')
  createMemberGivingCheckout(
    @Param('churchId') churchId: string,
    @Param('fundId') fundId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMemberGivingCheckoutDto,
  ) {
    return this.paymentsService.createMemberGivingCheckout(
      churchId,
      fundId,
      user.sub,
      dto,
    );
  }
}

@Public()
@Controller('public/giving')
export class PaymentsPublicGivingController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Declarado antes das rotas :churchSlug para não ser capturado por elas. */
  @Get('donations/:donationId/receipt')
  getGivingDonationReceipt(@Param('donationId') donationId: string) {
    return this.paymentsService.getGivingDonationReceipt(donationId);
  }

  @Get(':churchSlug/:fundSlug')
  getPublicGivingFund(
    @Param('churchSlug') churchSlug: string,
    @Param('fundSlug') fundSlug: string,
  ) {
    return this.paymentsService.getPublicGivingFund(churchSlug, fundSlug);
  }

  @Post(':churchSlug/:fundSlug/checkout')
  createGivingCheckout(
    @Param('churchSlug') churchSlug: string,
    @Param('fundSlug') fundSlug: string,
    @Body() dto: CreateGivingCheckoutDto,
  ) {
    return this.paymentsService.createGivingCheckout(churchSlug, fundSlug, dto);
  }
}

@Public()
@Controller('payments/connect')
export class PaymentsConnectWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody) {
      throw new BadRequestException('Raw body ausente para webhook Stripe.');
    }

    return this.paymentsService.handleConnectWebhook(rawBody, signature);
  }
}
