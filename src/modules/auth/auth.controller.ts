import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { REFRESH_COOKIE } from '../../common/constants/cookies';
import { AuthCookiesService } from './auth-cookies.service';
import type { AuthResponse } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookiesService: AuthCookiesService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { session, tokens } = await this.authService.login(dto);

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtPayload): Promise<AuthResponse> {
    return this.authService.getSession(user);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const { session, tokens } = await this.authService.refresh(refreshToken ?? '');

    this.authCookiesService.setAuthCookies(res, tokens, session.church.id);

    return session;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): void {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    this.authService.logout(refreshToken);
    this.authCookiesService.clearAuthCookies(res);
  }
}
