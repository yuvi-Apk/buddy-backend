// Extra fields this app adds to the Express request.
import "express";
import type { Subject } from "../modules/session/session.schema.js";

declare global {
  namespace Express {
    interface Request {
      /**
       * Input that passed the route's validate() schemas (RULES.md #7).
       * Controllers read input from here, never from req.body / req.query / req.params.
       */
      validated: {
        body: unknown;
        query: unknown;
        params: unknown;
      };

      /** Set by verifyAdmin and verifyUser: who is calling and through which session. */
      auth?: {
        subject: Subject;
        sessionId: string;
      };
    }
  }
}
