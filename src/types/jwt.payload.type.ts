// What is stored inside an access token. Kept small: IDs only, never personal data.

export interface AdminJwtPayload {
  adminId: string;
  sessionId: string;
}

export interface UserJwtPayload {
  userId: string;
  sessionId: string;
}
