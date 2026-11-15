// core-rules #16: every list endpoint is paginated and the page size has a hard maximum.
//
//   schema:      export const listRolesQuery = paginationQuery.extend({ search: z.string().optional() });
//   repository:  prisma.role.findMany({ ...toSkipTake(query), where, select })
//   controller:  new ApiResponse(200, paginated(items, total, query), "Roles fetched")
import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

// Query-string values arrive as strings, so they are coerced to numbers.
export const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export interface PageParams {
  page: number;
  limit: number;
}

export interface Paginated<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Converts page/limit into Prisma's skip/take. */
export const toSkipTake = ({ page, limit }: PageParams) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export function paginated<T>(
  items: T[],
  total: number,
  { page, limit }: PageParams
): Paginated<T> {
  return {
    items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
