import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { REFRESH_COOKIE } from '../../common/constants/cookies';
import { AuthCookiesService } from './auth-cookies.service';
import type { AuthResponse, RegisterChurchResponse } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RegisterChurchDto } from './dto/register-church.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SwitchChurchDto } from './dto/switch-church.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './auth.types';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookiesService: AuthCookiesService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { session, tokens } = await this.authService.login(dto);

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('register-church')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async registerChurch(
    @Body() dto: RegisterChurchDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterChurchResponse> {
    const result = await this.authService.registerChurch(dto);

    if ('pending' in result) {
      return result.pending;
    }

    this.authCookiesService.setAuthCookies(res, result.tokens, result.session.church.id);

    return result.session;
  }

  @Get('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token ?? '');
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email?.trim().toLowerCase());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtPayload): Promise<AuthResponse> {
    return this.authService.getSession(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { session, tokens } = await this.authService.updateProfile(
      user.sub,
      user.churchId,
      dto,
    );

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const { session, tokens } = await this.authService.refresh(
      refreshToken ?? '',
    );

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('switch-church')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async switchChurch(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchChurchDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { session, tokens } = await this.authService.switchChurch(
      user.sub,
      dto.churchId,
    );

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    this.authService.logout(refreshToken);
    this.authCookiesService.clearAuthCookies(res);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { session, tokens } = await this.authService.changePassword(
      user.sub,
      dto,
    );

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Get('reset-password/validate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validateResetToken(@Query('token') token: string) {
    return this.authService.validateResetToken(token ?? '');
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
