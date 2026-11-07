import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard, AuthRequest } from '../auth';
import { ReportAssistantService } from './assistant.service';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportAssistantController {
  constructor(@Inject(ReportAssistantService) private assistant: ReportAssistantService) {}

  @Post('interpret')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  interpret(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.assistant.interpret(request, body);
  }

  @Post('transcribe')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
    }),
  )
  transcribe(@Req() request: AuthRequest, @UploadedFile() audio?: Express.Multer.File) {
    return this.assistant.transcribe(request, audio);
  }
}
