// Answers "may this role open this page?".
//
// The pages a role may access are read from Postgres once, then kept in Redis
// ("role-perms:<roleId>"). Whoever changes a role must call invalidate(roleId) so the
// change applies on the next request.
import {
  isPageName,
  PAGES,
  SUPER_ADMIN_ROLE,
  type PageName,
} from "../../config/rbac.config.js";
import type { Redis } from "../../config/redis.js";

// Implemented by RoleRepository. Kept as an interface so core does not depend on a module.
export interface RolePagesLoader {
  findAllowedPages(roleId: string): Promise<string[]>;
}

interface RoleRef {
  id: string;
  name: string;
}

const CACHE_TTL_SECONDS = 60 * 60;
const cacheKey = (roleId: string) => `role-perms:${roleId}`;

export class PermissionService {
  constructor(
    private readonly loader: RolePagesLoader,
    private readonly redis: Redis
  ) {}

  // Every page this role may access. SUPER_ADMIN gets all of them.
  async allowedPages(role: RoleRef): Promise<PageName[]> {
    if (role.name === SUPER_ADMIN_ROLE) return [...PAGES];

    const cached = await this.readCache(role.id);
    if (cached) return cached;

    const pages = (await this.loader.findAllowedPages(role.id)).filter(
      isPageName
    );
    await this.writeCache(role.id, pages);
    return pages;
  }

  async hasAccess(role: RoleRef, page: PageName): Promise<boolean> {
    return (await this.allowedPages(role)).includes(page);
  }

  async hasAnyAccess(role: RoleRef, pages: PageName[]): Promise<boolean> {
    const allowed = await this.allowedPages(role);
    return pages.some((page) => allowed.includes(page));
  }

  // Call after a role's permissions change or the role is deleted.
  async invalidate(roleId: string): Promise<void> {
    await this.redis.del(cacheKey(roleId));
  }

  private async readCache(roleId: string): Promise<PageName[] | null> {
    try {
      const raw = await this.redis.get(cacheKey(roleId));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter(
            (page): page is PageName =>
              typeof page === "string" && isPageName(page)
          )
        : null;
    } catch {
      return null; // Redis down or bad value: fall back to Postgres.
    }
  }

  private async writeCache(roleId: string, pages: PageName[]): Promise<void> {
    try {
      await this.redis.set(
        cacheKey(roleId),
        JSON.stringify(pages),
        "EX",
        CACHE_TTL_SECONDS
      );
    } catch {
      // Redis is only a cache here.
    }
  }
}
