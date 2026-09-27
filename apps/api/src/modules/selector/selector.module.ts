import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { SelectorController } from './selector.controller';
import { SelectorService } from './selector.service';

@Module({
  // Каталог — за товарами під розрахунок; правила добору лишаються в SelectorService.
  imports: [CatalogModule],
  controllers: [SelectorController],
  providers: [SelectorService],
  exports: [SelectorService],
})
export class SelectorModule {}
