// Extra fields this app adds to the Express request.
import "express";
import type { AuthenticatedAdmin } from "../modules/admin-auth/index.js";
import type { SessionOwner } from "../modules/session/index.js";
import type { AuthenticatedUser } from "../modules/user-auth/index.js";

declare global {
  namespace Express {
    interface Request {
      // Input that passed the route's validate() schemas (core-rules #7).
      // Controllers read input from here, never from req.body / req.query / req.params.
      validated: {
        body: unknown;
        query: unknown;
        params: unknown;
      };

      // Set by verifyAdmin and verifyUser: who is calling and through which session.
      auth?: {
        owner: SessionOwner;
        sessionId: string;
      };

      // Set by verifyAdmin: the signed-in admin and their role.
      admin?: AuthenticatedAdmin;

      // Set by verifyUser: the signed-in app user.
      user?: AuthenticatedUser;
    }
  }
}
