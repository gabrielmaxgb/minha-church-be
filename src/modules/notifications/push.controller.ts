import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import {
  RemovePushSubscriptionDto,
  UpsertPushSubscriptionDto,
} from './dto/push-subscription.dto';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { publicKey: this.pushService.getPublicKey() };
  }

  @Get('status')
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.pushService.getStatus(user.sub);
  }

  @Post('subscriptions')
  @HttpCode(200)
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpsertPushSubscriptionDto,
  ) {
    return this.pushService.upsertSubscription(user.sub, {
      endpoint: body.endpoint,
      keys: body.keys,
      userAgent: body.userAgent,
    });
  }

  @Delete('subscriptions')
  @HttpCode(200)
  remove(
    @CurrentUser() user: JwtPayload,
    @Body() body: RemovePushSubscriptionDto,
  ) {
    return this.pushService.removeSubscription(user.sub, body.endpoint);
  }
}
