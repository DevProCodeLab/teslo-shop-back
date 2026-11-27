import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SeedService } from './seed.service';

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @Get()
  // Endpoint deliberadamente público para el curso.
  // Para protegerlo: importar { Auth } de '../auth/decorators' y
  // { ValidRoles } de '../auth/interfaces' y añadir @Auth(ValidRoles.admin).
  @ApiOperation({
    summary: 'Destruye y crea una nueva base de datos',
    description:
      'Destruye y crea la base de datos de productos y usuarios, esto invalida también tokens existentes y usuarios creados.',
  })
  @ApiResponse({ status: 200, description: 'Seed ejecutado con éxito' })
  executeSeed() {
    return this.seedService.runSeed();
  }
}
