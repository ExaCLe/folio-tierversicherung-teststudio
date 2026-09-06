import type { AgricultureRole } from '../../shared/agriculture';

export class AgricultureError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'AgricultureError';
  }
}

export function requireRole(role: AgricultureRole, expected: AgricultureRole): void {
  if (role !== expected) {
    throw new AgricultureError(403, 'ROLE_REQUIRED', `Diese Aktion ist nur in der Rolle ${expected} zulässig.`);
  }
}

export function roleFromHeader(value: string | undefined): AgricultureRole {
  if (value === undefined) return 'Vermittler';
  if (value !== 'Vermittler' && value !== 'Direktion' && value !== 'Sachbearbeiter') {
    throw new AgricultureError(400, 'INVALID_ROLE', 'Die Benutzerrolle ist ungültig. Wählen Sie Vermittler, Direktion oder Sachbearbeiter.');
  }
  return value;
}
