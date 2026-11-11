import "server-only";
import type { Tx } from "@/lib/db";
import { toJson } from "@/modules/audit";

/**
 * Transactional outbox: write the event in the SAME database transaction as
 * the change it describes. Either both commit or neither does, so another
 * service (the Phase 3 Java ledger, via Kafka) can never miss an approval or
 * see one that was rolled back. Step 4 adds the relay that publishes these.
 */
export async function enqueueOutbox(
  tx: Tx,
  event: { orgId: string; aggregateType: string; aggregateId: string; type: string; payload: unknown },
) {
  return tx.outboxEvent.create({
    data: {
      orgId: event.orgId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      type: event.type,
      payload: toJson(event.payload) ?? {},
    },
  });
}
