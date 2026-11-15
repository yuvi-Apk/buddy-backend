---
paths:
  - "src/core/ai/**"
  - "src/core/queue/**"
  - "src/jobs/**"
  - "src/worker.ts"
  - "src/modules/book/**"
  - "src/modules/assessment/**"
  - "src/modules/weakness-profile/**"
  - "src/modules/learning-path/**"
  - "src/modules/tutor/**"
---

# AI rules

These apply from the first AI feature. `src/core/ai` does not exist yet.

| #   | Rule                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Model providers and Qdrant are called only from `src/core/ai`. Modules use the interfaces (`LlmProvider`, `EmbeddingProvider`, `VectorStore`). |
| A2  | Tutor answers use only retrieved book passages and cite them. With no matching passage, the tutor says so instead of answering.                |
| A3  | Every Qdrant search filters by `schoolId` and class. Postgres is the source of truth; Qdrant holds only vectors and the IDs pointing back.     |
| A4  | Student text is untrusted input. It never becomes system instructions, and model output is validated with Zod before it is stored or acted on. |
| A5  | Every model call records user, feature, tokens and cost. Each user has a daily quota.                                                          |
| A6  | Students are minors. Send the model the minimum personal data, never names or phone numbers.                                                   |
| A7  | Prompts live in versioned files under `src/core/ai/prompts`, not inline in services.                                                           |
| A8  | Slow work (book ingestion, embeddings, reports) runs in a job that is safe to run twice, not inside the request.                               |

## How AI plugs in

- `LlmProvider`, `EmbeddingProvider` and `VectorStore` are interfaces in `src/core/ai`. One class per vendor
  implements them, chosen in `src/container.ts`, so changing vendor touches no module.
- Postgres stays the source of truth. Qdrant stores vectors plus `{ schoolId, classId, bookId, chunkId }`, so
  every search can be filtered by school and results joined back to Postgres rows.
- Book ingestion (extract → chunk → embed → upsert) is a BullMQ job run by `src/worker.ts`, never inside a request.
- Tutor replies stream over SSE from a normal module route.
