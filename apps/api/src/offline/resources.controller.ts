import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard, AuthRequest } from '../auth';
import { ResourcesService } from './resources.service';
@Controller('offline/resources')
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(@Inject(ResourcesService) private resources: ResourcesService) {}
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 10000 },
    }),
  )
  async stage(
    @Req() request: AuthRequest,
    @Body() body: { metadata?: string },
    @UploadedFile() file: Express.Multer.File,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!file || !body.metadata)
      throw new BadRequestException('Incluye el archivo y metadata JSON.');
    let raw: unknown;
    try {
      raw = JSON.parse(body.metadata);
    } catch {
      throw new BadRequestException('metadata debe ser JSON válido.');
    }
    return this.resources.stage(request, raw, file.buffer);
  }
}
// Published catalog media can be viewed publicly. Unpublished media needs fresh catalog permission.
// Staged orphans are never exposed by this route, nor by the static /assets directory.
@Controller('catalog/offline-media')
export class OfflineMediaController {
  constructor(@Inject(ResourcesService) private resources: ResourcesService) {}
  @Get(':id')
  async media(@Req() request: AuthRequest, @Param('id') id: string, @Res() response: Response) {
    const result = await this.resources.media(request, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', result.mime);
    response.send(result.bytes);
  }
}
