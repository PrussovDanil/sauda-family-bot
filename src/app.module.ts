import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SaudaModule } from './sauda/sauda.module';

@Module({
  imports: [SaudaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
