// Extra fields this app adds to the Express request.
import "express";

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
    }
  }
}
