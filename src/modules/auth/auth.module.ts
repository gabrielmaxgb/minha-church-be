import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ChurchesModule } from '../churches/churches.module';
import { UsersModule } from '../users/users.module';
import { PrivacyModule } from '../../common/privacy/privacy.module';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    ChurchesModule,
    PrivacyModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>(
            'jwt.accessExpiresIn',
          ) as `${number}m`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthCookiesService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
