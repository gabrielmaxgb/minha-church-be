import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChurchPermission } from '@prisma/client';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChurchAccessGuard, PermissionsGuard } from '../../common/guards';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import {
  CreatePastoralNoteDto,
  UpdatePastoralNoteDto,
} from './dto/pastoral-note.dto';
import { PastoralNotesService } from './pastoral-notes.service';

@Controller('churches/:churchId/pastoral-notes')
@UseGuards(JwtAuthGuard, ChurchAccessGuard, PermissionsGuard)
@RequirePermission(ChurchPermission.pastoral_care)
export class PastoralNotesController {
  constructor(private readonly pastoralNotesService: PastoralNotesService) {}

  @Get('summary')
  getSummary(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pastoralNotesService.getSummary(churchId, user.sub);
  }

  @Get('members/:memberId')
  listForMember(
    @Param('churchId') churchId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pastoralNotesService.listForMember(
      churchId,
      user.sub,
      memberId,
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      },
    );
  }

  @Post()
  create(
    @Param('churchId') churchId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePastoralNoteDto,
  ) {
    return this.pastoralNotesService.create(churchId, user.sub, dto);
  }

  @Patch(':noteId')
  update(
    @Param('churchId') churchId: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePastoralNoteDto,
  ) {
    return this.pastoralNotesService.update(churchId, user.sub, noteId, dto);
  }

  @Delete(':noteId')
  remove(
    @Param('churchId') churchId: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pastoralNotesService.softDelete(churchId, user.sub, noteId);
  }
}
