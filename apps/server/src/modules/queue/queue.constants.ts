/** BullMQ queue names (tech plan §19 / §27). */
export const QUEUE_NAMES = {
  mail: 'mail',
  auditArchive: 'audit-archive',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
