import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../../observability/observability.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [ObservabilityModule],
  controllers: [HealthController],
  providers: [HealthService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class HealthModule {}
