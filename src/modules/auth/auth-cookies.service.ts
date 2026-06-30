import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import {
  AUTH_COOKIE,
  CHURCH_COOKIE,
  REFRESH_COOKIE,
} from '../../common/constants/cookies';
import type { IssuedTokens } from './auth.types';

@Injectable()
export class AuthCookiesService {
  constructor(private readonly configService: ConfigService) {}

  setAuthCookies(res: Response, tokens: IssuedTokens, churchId: string) {
    const isProduction =
      this.configService.get<string>('nodeEnv') === 'production';
    const refreshMaxAgeSeconds = 60 * 60 * 24 * 7;

    res.cookie(AUTH_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: tokens.expiresIn * 1000,
    });

    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: refreshMaxAgeSeconds * 1000,
    });

    res.cookie(CHURCH_COOKIE, churchId, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: refreshMaxAgeSeconds * 1000,
    });
  }

  clearAuthCookies(res: Response) {
    const isProduction =
      this.configService.get<string>('nodeEnv') === 'production';

    for (const name of [AUTH_COOKIE, REFRESH_COOKIE, CHURCH_COOKIE]) {
      res.clearCookie(name, {
        httpOnly: name !== CHURCH_COOKIE,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
      });
    }
  }
}
