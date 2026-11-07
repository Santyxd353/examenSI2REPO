import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { exportReportCsv } from '@lumina/reporting';
import type { Response } from 'express';
import { AuthGuard, AuthRequest } from '../auth';
import { ReportDatasetService } from './dataset.service';

const noCache = 'private, no-store';
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportController {
  constructor(@Inject(ReportDatasetService) private datasets: ReportDatasetService) {}
  @Post('datasets')
  @Header('Cache-Control', noCache)
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.datasets.create(req.user, body);
  }
  @Get('datasets/:id')
  @Header('Cache-Control', noCache)
  manifest(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.datasets.manifest(req.user, id);
  }
  @Get('datasets/:id/rows')
  @Header('Cache-Control', noCache)
  page(@Req() req: AuthRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.datasets.page(req.user, id, query);
  }
  @Post('execute')
  @HttpCode(200)
  @Header('Cache-Control', noCache)
  execute(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.datasets.execute(req.user, body);
  }
  @Post('export')
  @HttpCode(200)
  async export(@Req() req: AuthRequest, @Body() body: unknown, @Res() response: Response) {
    const result = await this.datasets.execute(req.user, body);
    response.setHeader('Cache-Control', noCache);
    response
      .attachment(`lumina-${result.datasetId}.csv`)
      .type('text/csv')
      .send(exportReportCsv(result));
  }
}
