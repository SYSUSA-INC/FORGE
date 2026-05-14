/**
 * BL-12c — bounds for per-tenant audit-log retention. The DB column
 * itself is unbounded so ops can lower the floor without a migration
 * if ever needed, but the action layer + UI hold the contract.
 */
export const AUDIT_RETENTION_MIN_DAYS = 90;
export const AUDIT_RETENTION_MAX_DAYS = 3650;
export const AUDIT_RETENTION_DEFAULT_DAYS = 365;
