// apps/backend/src/modules/auth/role-router.ts

export const executeEcosystemRoleRouting = (role: string): string => {
  // SWITCH FUNCTION PATTERN 3: Distribusi Jalur Berdasarkan RBAC Peran Sistem
  switch (role) {
    case 'SUPERADMIN':
      return 'https://cariin.id/admin/global-control';
    case 'MITRA_OWNER':
      return 'https://admin.apotekin.id/dashboard/overview';
    case 'MITRA_STAFF':
      return 'https://pos.apotekin.id/workspace/cashier';
    case 'CUSTOMER':
      return 'https://cariin.id/marketplace/pharmacies';
    default:
      // Error ini akan ditangkap oleh Switch Pattern 2 di globalErrorHandler
      throw new Error('ACCESS_DENIED_INVALID_ROLE'); 
  }
};