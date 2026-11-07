import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthRequest } from '../auth';
import { ReportDefinitionsService } from './definitions.service';
const privateCache = 'private, no-store';

@Controller('reports/definitions')
@UseGuards(AuthGuard)
export class ReportDefinitionsController {
  constructor(@Inject(ReportDefinitionsService) private definitions: ReportDefinitionsService) {}
  @Get()
  @Header('Cache-Control', privateCache)
  list(@Req() request: AuthRequest) {
    return this.definitions.list(request.user);
  }
  @Get(':id')
  @Header('Cache-Control', privateCache)
  get(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.definitions.get(request.user, id);
  }
  @Post()
  @Header('Cache-Control', privateCache)
  create(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.definitions.create(request.user, body);
  }
  @Patch(':id')
  @Header('Cache-Control', privateCache)
  edit(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.definitions.edit(request.user, id, body);
  }
  @Delete(':id')
  @Header('Cache-Control', privateCache)
  archive(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.definitions.archive(request.user, id, query);
  }
}
