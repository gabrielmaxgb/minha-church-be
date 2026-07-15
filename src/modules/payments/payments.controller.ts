import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Header,
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
import {
  CreateFinanceEntryDto,
  UpdateFinanceEntryDto,
} from './dto/finance-entry.dto';
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

  @Get('donations/mine')
  listMyGivingDonations(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.listMyGivingDonations(churchId, user.sub);
  }

  @Get('subscriptions/mine')
  listMyGivingSubscriptions(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.listMyGivingSubscriptions(churchId, user.sub);
  }

  @Get('subscriptions')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  listGivingSubscriptions(
    @Param('churchId') churchId: string,
    @Query('fundId') fundId?: string,
    @Query('status') status?: string,
  ) {
    return this.paymentsService.listGivingSubscriptions(churchId, {
      fundId,
      status,
    });
  }

  @Post('subscriptions/:subscriptionId/cancel')
  cancelMyGivingSubscription(
    @Param('churchId') churchId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.cancelGivingSubscription(
      churchId,
      subscriptionId,
      user.sub,
    );
  }

  @Post('subscriptions/:subscriptionId/cancel-as-treasurer')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  cancelGivingSubscriptionAsTreasurer(
    @Param('churchId') churchId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.cancelGivingSubscription(
      churchId,
      subscriptionId,
      user.sub,
      { asTreasurer: true },
    );
  }

  @Post('events/:eventId/ticket-checkout')
  createEventTicketCheckout(
    @Param('churchId') churchId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.createEventTicketCheckout(
      churchId,
      eventId,
      user.sub,
    );
  }

  @Get('donations')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  listGivingDonations(
    @Param('churchId') churchId: string,
    @Query('fundId') fundId?: string,
    @Query('status') status?: string,
    @Query('memberId') memberId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.listGivingDonations(churchId, {
      fundId,
      status,
      memberId,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('donations/export')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contribuicoes.csv"')
  exportGivingDonations(
    @Param('churchId') churchId: string,
    @Query('fundId') fundId?: string,
    @Query('status') status?: string,
    @Query('memberId') memberId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.paymentsService.exportGivingDonationsCsv(churchId, {
      fundId,
      status,
      memberId,
      from,
      to,
    });
  }

  @Post('donations/:donationId/refund')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  refundGivingDonation(
    @Param('churchId') churchId: string,
    @Param('donationId') donationId: string,
  ) {
    return this.paymentsService.refundGivingDonation(churchId, donationId);
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

  @Get('entries/summary')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  getFinanceEntriesSummary(
    @Param('churchId') churchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.paymentsService.getFinanceEntriesSummary(churchId, {
      from,
      to,
    });
  }

  @Get('entries/export')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lancamentos-manuais.csv"')
  exportFinanceEntries(
    @Param('churchId') churchId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.paymentsService.exportFinanceEntriesCsv(churchId, {
      type,
      from,
      to,
    });
  }

  @Get('entries')
  @UseGuards(PermissionsGuard)
  @RequirePermission(
    ChurchPermission.finances_access,
    ChurchPermission.receivables_manage,
  )
  listFinanceEntries(
    @Param('churchId') churchId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.listFinanceEntries(churchId, {
      type,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('entries')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  createFinanceEntry(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFinanceEntryDto,
  ) {
    return this.paymentsService.createFinanceEntry(churchId, user.sub, dto);
  }

  @Patch('entries/:entryId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  updateFinanceEntry(
    @Param('churchId') churchId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateFinanceEntryDto,
  ) {
    return this.paymentsService.updateFinanceEntry(churchId, entryId, dto);
  }

  @Delete('entries/:entryId')
  @UseGuards(PermissionsGuard)
  @RequirePermission(ChurchPermission.receivables_manage)
  deleteFinanceEntry(
    @Param('churchId') churchId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.paymentsService.deleteFinanceEntry(churchId, entryId);
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
