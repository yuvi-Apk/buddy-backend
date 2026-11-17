// Role-based access control is defined here, in code.
// A "page" is one area of the admin panel. A role is granted access page by page
// (AdminPermission.canAccess). To protect a new admin feature:
//   1. add its page name to PAGES below
//   2. guard its routes with requirePermission("<PAGE>")
// The database only stores which role may access which page name.

export const PAGES = ["ROLE", "UPLOAD", "ORGANIZATION"] as const;

export type PageName = (typeof PAGES)[number];

export const isPageName = (value: string): value is PageName =>
  (PAGES as readonly string[]).includes(value);

// Admins with this role skip every permission check. It cannot be edited or deleted.
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
