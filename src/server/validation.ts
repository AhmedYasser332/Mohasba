import { ServiceError } from './errors';

export function assertValidIanaTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    throw new ServiceError(
      400,
      'VALIDATION_ERROR',
      `Invalid IANA timezone: ${tz}`,
    );
  }
}
