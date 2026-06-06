'use client';

import React from 'react';

interface FeatureGateProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  requiredPermissions?: string[];
  userRole?: string;
  userPermissions?: string[];
  fallback?: React.ReactNode;
}

export function FeatureGate({
  children,
  allowedRoles = [],
  requiredPermissions = [],
  userRole = '',
  userPermissions = [],
  fallback = null,
}: FeatureGateProps) {
  const hasAllowedRole = allowedRoles.length === 0 || allowedRoles.includes(userRole);
  
  const hasRequiredPermissions = requiredPermissions.every(permission =>
    userPermissions.includes(permission)
  );

  if (hasAllowedRole && hasRequiredPermissions) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

interface RoleGateProps {
  children: React.ReactNode;
  allowedRoles: string[];
  userRole?: string;
  fallback?: React.ReactNode;
}

export function RoleGate({
  children,
  allowedRoles,
  userRole = '',
  fallback = null,
}: RoleGateProps) {
  if (allowedRoles.includes(userRole)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

interface PermissionGateProps {
  children: React.ReactNode;
  requiredPermissions: string[];
  userPermissions?: string[];
  fallback?: React.ReactNode;
}

export function PermissionGate({
  children,
  requiredPermissions,
  userPermissions = [],
  fallback = null,
}: PermissionGateProps) {
  const hasAllPermissions = requiredPermissions.every(permission =>
    userPermissions.includes(permission)
  );

  if (hasAllPermissions) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
