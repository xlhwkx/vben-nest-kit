import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Optional async job skeleton (BullMQ). Safe when QUEUE_ENABLED=false:
 * QueueService is a no-op façade and does not open BullMQ connections.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class QueueModule {}
