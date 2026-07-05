import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AUTH_COOKIE } from '../../../common/constants/cookies';
import type { JwtPayload } from '../auth.types';

function extractAccessTokenFromCookie(request: Request): string | null {
  const cookies = request.cookies as
    Partial<Record<string, string>> | undefined;
  const token = cookies?.[AUTH_COOKIE];

  return typeof token === 'string' && token.length > 0 ? token : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const isProduction = configService.get<string>('nodeEnv') === 'production';
    const tokenExtractors = [extractAccessTokenFromCookie];

    if (!isProduction) {
      tokenExtractors.push(ExtractJwt.fromAuthHeaderAsBearerToken());
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors(tokenExtractors),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.churchId) {
      throw new UnauthorizedException('Token inválido.');
    }

    return payload;
  }
}
