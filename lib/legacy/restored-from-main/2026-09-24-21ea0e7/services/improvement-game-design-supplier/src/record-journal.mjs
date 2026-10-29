import { createSemanticRecordJournal } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section/semantic-record-journal";

export const OBJECT_KIND = "red-cup.improvement-game-design-supplier.journal-record";

export function createImprovementGameDesignSupplierRecordJournal({ root }) {
  return createSemanticRecordJournal({ root, objectKind: OBJECT_KIND });
}
