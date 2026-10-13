import type { Role } from './types.js';

export const PERMISSIONS = [
  'sales.create',
  'sales.read.own',
  'sales.read.all',
  'sales.void',
  'products.read',
  'products.quickCreate',
  'products.edit',
  'customers.read',
  'customers.create',
  'customers.editCreditLimit',
  'credit.fiado',
  'credit.abono',
  'discount.upTo10',
  'discount.any',
  'authorize.override',
  'cash.operate',
  'reports.financial',
  'reports.sire',
  'users.manage',
  'settings.read',
  'settings.edit',
  'banking.edit',
  'alerts.read',
  'alerts.manage',
  'notifications.send',
  'inventory.edit',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  VENDEDOR: [
    'sales.create',
    'sales.read.own',
    'products.read',
    'products.quickCreate',
    'customers.read',
    'customers.create',
    'credit.fiado',
    'credit.abono',
    'discount.upTo10',
    'cash.operate',
    'settings.read',
    'alerts.read',
  ],
  // El Agente Financiero analiza y recomienda: no vende ni toca inventario.
  AGENTE: [
    'sales.read.all',
    'products.read',
    'customers.read',
    'reports.financial',
    'settings.read',
    'alerts.read',
    'alerts.manage',
    'notifications.send',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}
