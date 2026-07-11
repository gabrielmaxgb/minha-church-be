import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { ChurchAccessGuard } from '../../common/guards/church-access.guard';
import { ChurchOwnerGuard } from '../../common/guards/church-owner.guard';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('churches/:churchId/billing')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, ChurchOwnerGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  createCheckout(
    @Param('churchId') churchId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckoutSession(churchId, dto.interval);
  }

  @Get('checkout/confirm')
  confirmCheckout(
    @Param('churchId') churchId: string,
    @Query('session_id') sessionId: string | undefined,
  ) {
    if (!sessionId?.trim()) {
      throw new BadRequestException('session_id é obrigatório.');
    }

    return this.billingService.confirmCheckoutSession(churchId, sessionId.trim());
  }

  @Get('subscription')
  getSubscription(@Param('churchId') churchId: string) {
    return this.billingService.getSubscriptionSummary(churchId);
  }

  @Get('invoices')
  listInvoices(@Param('churchId') churchId: string) {
    return this.billingService.listInvoices(churchId);
  }

  @Post('portal')
  createPortal(@Param('churchId') churchId: string) {
    return this.billingService.createPortalSession(churchId);
  }
}

@Public()
@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody) {
      throw new BadRequestException('Raw body ausente para webhook Stripe.');
    }

    return this.billingService.handleWebhook(rawBody, signature);
  }
}

@Public()
@Controller('pricing')
export class PricingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  getPricing() {
    return this.billingService.getPricingCatalog();
  }
}
