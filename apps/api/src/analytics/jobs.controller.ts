import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, AuthRequest } from '../auth';
import { AnalysisJobs } from './jobs.service';
import { AnalysisResults } from './results.service';

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalysisJobsController {
  constructor(
    @Inject(AnalysisJobs) private jobs: AnalysisJobs,
    @Inject(AnalysisResults) private results: AnalysisResults,
  ) {}
  @Post('jobs')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  create(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.jobs.create(request.user, body);
  }
  @Get('jobs')
  @Header('Cache-Control', 'private, no-store')
  list(@Req() request: AuthRequest) {
    return this.results.list(request.user);
  }
  @Get('jobs/:id')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.results.get(request.user, id);
  }
  @Get('results/:id')
  async download(@Req() request: AuthRequest, @Param('id') id: string, @Res() response: Response) {
    const job = await this.results.get(request.user, id);
    response.setHeader('Cache-Control', 'private, no-store');
    return response
      .attachment('lumina-analisis-' + job.source.toLowerCase() + '-' + job.id + '.json')
      .json(job);
  }
}
