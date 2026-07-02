import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { generateTemporaryPassword } from '../utils/credentials';
import { formatCpf } from '../utils/cpf';
import { encryptSecret } from '../utils/secret-encryption';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PasswordCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issueTemporaryPassword(userId: string): Promise<{
    login: string;
    temporaryPassword: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const secret = this.config.get<string>('jwt.secret') ?? '';
    const temporaryPasswordEnc = encryptSecret(temporaryPassword, secret);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordEnc,
      },
    });

    const login = user.cpf ? formatCpf(user.cpf) : user.email;

    return { login, temporaryPassword };
  }
}
