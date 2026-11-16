// Delivers a one-time code to a phone. To add a real SMS provider:
//   1. write a class here that implements OtpSender
//   2. add its name to OTP_SENDER in src/config/env.ts
//   3. choose it in src/container.ts
import type { Logger } from "pino";

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

// Development only: writes the code to the server log instead of sending an SMS.
// env.ts refuses to start in production with this sender.
export class LogOtpSender implements OtpSender {
  constructor(private readonly logger: Logger) {}

  send(phone: string, code: string): Promise<void> {
    // "devOtpCode" is deliberately not on the logger's redaction list.
    this.logger.info({ phone, devOtpCode: code }, "DEV ONLY: OTP code");
    return Promise.resolve();
  }
}
