// Composition root: the only file that creates shared infrastructure and the modules.
// Each module builds its own repository → service → controller in its index.ts.
// Order: infrastructure → modules (a module only gets services built before it) → guards.
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import type { HealthCheck } from "./core/health/health.routes.js";
import {
  GoogleIdTokenVerifier,
  type GoogleTokenVerifier,
} from "./core/security/GoogleIdTokenVerifier.js";
import { TokenService } from "./core/security/TokenService.js";
import {
  LocalStorageProvider,
  type StorageProvider,
} from "./core/storage/StorageProvider.js";
import {
  createPermissionGuards,
  createVerifyAdmin,
} from "./middlewares/admin/auth.middleware.js";
import { createRateLimiters } from "./middlewares/rateLimit.middleware.js";
import { createVerifyUser } from "./middlewares/user/auth.middleware.js";
import { createRequireOrganizationRole } from "./middlewares/user/organization-role.middleware.js";
import { createAdminAccountModule } from "./modules/admin-panel/admin-account/index.js";
import { createAdminAuthModule } from "./modules/admin-panel/admin-auth/index.js";
import { createClassroomModule } from "./modules/user-panel/classroom/index.js";
import { createInviteModule } from "./modules/shared/invite/index.js";
import { createJoinRequestModule } from "./modules/user-panel/join-request/index.js";
import { createOrganizationModule } from "./modules/shared/organization/index.js";
import { createRoleModule } from "./modules/admin-panel/role/index.js";
import { createSessionModule } from "./modules/shared/session/index.js";
import { createUploadModule } from "./modules/admin-panel/upload/index.js";
import { createUserAuthModule } from "./modules/user-panel/user-auth/index.js";
import type { Guards, Infra } from "./types/module.types.js";

// What GET /health/ready checks. Each check throws when its dependency is down.
function healthChecks(): Record<string, HealthCheck> {
  return {
    postgres: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    redis: async () => {
      await redis.ping();
    },
  };
}

// Parts that tests (or a different deployment) may swap for their own implementation.
export interface ContainerOverrides {
  googleTokenVerifier?: GoogleTokenVerifier;
  storage?: StorageProvider;
}

export type Container = ReturnType<typeof createContainer>;

export function createContainer(overrides: ContainerOverrides = {}) {
  // Infrastructure
  const infra: Infra = { prisma, redis, logger };
  const tokenService = new TokenService({
    adminSecret: env.ADMIN_ACCESS_TOKEN_SECRET,
    userSecret: env.USER_ACCESS_TOKEN_SECRET,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  });
  const rateLimiters = createRateLimiters(redis);
  const googleTokenVerifier =
    overrides.googleTokenVerifier ??
    new GoogleIdTokenVerifier(redis, env.GOOGLE_CLIENT_IDS);
  // STORAGE_DRIVER has one value today ("local"). Add a case here with each new provider.
  const storage = overrides.storage ?? new LocalStorageProvider();

  // Modules (one line each; add new modules at the end)
  const session = createSessionModule(infra, { tokenService });
  const role = createRoleModule(infra);
  const adminAuth = createAdminAuthModule(infra, {
    sessionService: session.service,
    tokenService,
    googleTokenVerifier,
    permissionService: role.permissionService,
  });
  const userAuth = createUserAuthModule(infra, {
    sessionService: session.service,
    tokenService,
    googleTokenVerifier,
  });
  const upload = createUploadModule(infra, { storage });
  const organization = createOrganizationModule(infra, {
    userAuthService: userAuth.service,
  });
  const classroom = createClassroomModule(infra, {
    organizationService: organization.service,
  });
  const invite = createInviteModule(infra, {
    organizationService: organization.service,
    classroomService: classroom.service,
  });
  const joinRequest = createJoinRequestModule(infra, {
    organizationService: organization.service,
    classroomService: classroom.service,
  });
  const adminAccount = createAdminAccountModule(infra, {
    roleService: role.service,
    permissionService: role.permissionService,
    sessionService: session.service,
  });

  // Guards
  const guards: Guards = {
    verifyAdmin: createVerifyAdmin({
      tokenService,
      sessionService: session.service,
      adminAuthService: adminAuth.service,
    }),
    verifyUser: createVerifyUser({
      tokenService,
      sessionService: session.service,
      userAuthService: userAuth.service,
    }),
    ...createPermissionGuards(role.permissionService),
    requireOrganizationRole: createRequireOrganizationRole(
      organization.service
    ),
  };

  return {
    modules: {
      session,
      role,
      adminAuth,
      userAuth,
      upload,
      organization,
      classroom,
      invite,
      joinRequest,
      adminAccount,
    },
    guards,
    rateLimiters,
    tokenService,

    healthChecks: healthChecks(),

    // Closes database and cache connections. Called on shutdown and after tests.
    shutdown: async () => {
      await prisma.$disconnect();
      await redis.quit();
    },
  };
}
