import {
  DEFAULT_ROLE_PERMISSIONS,
  GRANULAR_PERMISSIONS_LIST,
  type AccessScope,
  type CustomPermissions,
  type GranularPermissionKey,
  type RosterRole,
} from "@/types/database";

export type PermissionSource = "inherited" | "custom_grant" | "custom_deny" | "locked";

export interface PermissionResolutionDetail {
  key: GranularPermissionKey;
  effective: boolean;
  defaultForRole: boolean;
  source: PermissionSource;
  lockedReason?: string;
}

export const ALL_GRANULAR_PERMISSION_KEYS: GranularPermissionKey[] = GRANULAR_PERMISSIONS_LIST.map(
  (p) => p.key
);

/**
 * Returns true if a specific permission key is locked by system security invariants for the given role.
 * - owner & company_owner: all permissions are locked to true.
 * - business_owner_viewer: all permissions are locked to false (strict read-only).
 * - marketing_director: locked to view_time_logs + export_reports only; all mutations locked to false.
 * - Non-owner roles: system-level permissions (manage_workspace, delete_clients) are locked to false,
 *   and member management (manage_members, invite_members) is locked to false for roles other than owner/company_owner/manager.
 */
export function getLockedPermissionState(
  role: RosterRole,
  permission: GranularPermissionKey
): { locked: boolean; value?: boolean; reason?: string } {
  if (role === "owner" || role === "company_owner") {
    return {
      locked: true,
      value: true,
      reason: "صلاحية أساسية ثابتة لمالك النظام / الشريك",
    };
  }

  if (role === "business_owner_viewer") {
    return {
      locked: true,
      value: false,
      reason: "حساب مشاهد فقط (قراءة دون تعديل أو تصدير)",
    };
  }

  if (role === "marketing_director") {
    const allowed = permission === "view_time_logs" || permission === "export_reports";
    return {
      locked: true,
      value: allowed,
      reason: allowed
        ? "صلاحية أساسية لمدير التسويق (التقارير والتصدير)"
        : "مدير التسويق مخصص للقراءة والتقارير والتصدير فقط دون تعديل أو اعتماد",
    };
  }

  // System administration locks for non-owners
  if (permission === "manage_workspace" || permission === "delete_clients") {
    return {
      locked: true,
      value: false,
      reason: "مقصورة على مالك النظام والشريك فقط",
    };
  }

  if (
    (permission === "manage_members" || permission === "invite_members") &&
    role !== "manager"
  ) {
    return {
      locked: true,
      value: false,
      reason: "إدارة الأعضاء والدعوات مقصورة على الإدارة فقط",
    };
  }

  return { locked: false };
}

/**
 * Merges custom_permissions from workspace_memberships and roster_people (if both provided),
 * giving precedence to membership custom_permissions when explicitly boolean.
 */
export function mergeCustomPermissions(
  primaryCustom?: CustomPermissions | null,
  fallbackCustom?: CustomPermissions | null
): CustomPermissions {
  const merged: CustomPermissions = {};
  const fallback = fallbackCustom && typeof fallbackCustom === "object" ? fallbackCustom : {};
  const primary = primaryCustom && typeof primaryCustom === "object" ? primaryCustom : {};

  for (const key of ALL_GRANULAR_PERMISSION_KEYS) {
    if (typeof primary[key] === "boolean") {
      merged[key] = primary[key];
    } else if (typeof fallback[key] === "boolean") {
      merged[key] = fallback[key];
    }
  }
  return merged;
}

/**
 * Resolves the canonical effective permissions object (all 14 boolean flags)
 * for a given role and custom_permissions payload.
 */
export function resolveEffectivePermissions(
  role: RosterRole,
  customPermissions?: CustomPermissions | null,
  fallbackCustomPermissions?: CustomPermissions | null
): Required<CustomPermissions> {
  const mergedCustom = mergeCustomPermissions(customPermissions, fallbackCustomPermissions);
  const roleDefaults = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.designer;
  const effective = {} as Required<CustomPermissions>;

  for (const key of ALL_GRANULAR_PERMISSION_KEYS) {
    const lockState = getLockedPermissionState(role, key);
    if (lockState.locked && typeof lockState.value === "boolean") {
      effective[key] = lockState.value;
      continue;
    }

    if (typeof mergedCustom[key] === "boolean") {
      effective[key] = Boolean(mergedCustom[key]);
    } else {
      effective[key] = Boolean(roleDefaults[key]);
    }
  }

  return effective;
}

/**
 * Sanitizes custom_permissions before persisting to the database so that locked permissions
 * cannot be escalated or corrupted.
 */
export function sanitizeCustomPermissionsForRole(
  role: RosterRole,
  customPermissions?: CustomPermissions | null
): CustomPermissions {
  const effective = resolveEffectivePermissions(role, customPermissions);
  return { ...effective };
}

/**
 * Returns full resolution metadata for each of the 14 permissions (effective value, role default, and source:
 * 'inherited' | 'custom_grant' | 'custom_deny' | 'locked').
 */
export function resolvePermissionDetails(
  role: RosterRole,
  customPermissions?: CustomPermissions | null,
  fallbackCustomPermissions?: CustomPermissions | null
): Record<GranularPermissionKey, PermissionResolutionDetail> {
  const mergedCustom = mergeCustomPermissions(customPermissions, fallbackCustomPermissions);
  const roleDefaults = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.designer;
  const details = {} as Record<GranularPermissionKey, PermissionResolutionDetail>;

  for (const key of ALL_GRANULAR_PERMISSION_KEYS) {
    const defaultForRole = Boolean(roleDefaults[key]);
    const lockState = getLockedPermissionState(role, key);

    if (lockState.locked && typeof lockState.value === "boolean") {
      details[key] = {
        key,
        effective: lockState.value,
        defaultForRole,
        source: "locked",
        lockedReason: lockState.reason,
      };
      continue;
    }

    if (typeof mergedCustom[key] === "boolean") {
      const val = Boolean(mergedCustom[key]);
      let source: PermissionSource = "inherited";
      if (val !== defaultForRole) {
        source = val ? "custom_grant" : "custom_deny";
      }
      details[key] = {
        key,
        effective: val,
        defaultForRole,
        source,
      };
    } else {
      details[key] = {
        key,
        effective: defaultForRole,
        defaultForRole,
        source: "inherited",
      };
    }
  }

  return details;
}

/**
 * Resolves the canonical access scope for a member based on their role and saved access_scope.
 */
export function resolveEffectiveAccessScope(
  role: RosterRole,
  savedScope?: AccessScope | string | null
): AccessScope {
  if (
    role === "owner" ||
    role === "company_owner" ||
    role === "manager" ||
    role === "marketing_director" ||
    role === "business_owner_viewer"
  ) {
    return "workspace";
  }

  const validScopes: AccessScope[] = [
    "workspace",
    "assigned_team",
    "assigned_clients",
    "assigned_tasks",
  ];
  if (savedScope && validScopes.includes(savedScope as AccessScope)) {
    return savedScope as AccessScope;
  }

  if (role === "strategy_lead" || role === "senior_reviewer") {
    return "assigned_team";
  }
  if (role === "strategist") {
    return "assigned_clients";
  }
  return "assigned_tasks";
}

/**
 * Checks if a roster person is directly assigned to a client row in any role.
 */
export function isDirectClientAssignee(client: any, rosterPersonId?: string | null): boolean {
  if (!client || !rosterPersonId) return false;
  if (client.owner_roster_id === rosterPersonId) return true;
  const rawTeam = client.team_assignment || client.client_team_assignments;
  const team = Array.isArray(rawTeam) ? rawTeam[0] : rawTeam;
  if (!team) return false;

  return (
    team.primary_strategist_id === rosterPersonId ||
    team.primary_copywriter_id === rosterPersonId ||
    team.primary_designer_id === rosterPersonId ||
    team.primary_video_editor_id === rosterPersonId ||
    team.strategy_reviewer_id === rosterPersonId ||
    team.copywriting_reviewer_id === rosterPersonId ||
    team.design_reviewer_id === rosterPersonId ||
    team.video_reviewer_id === rosterPersonId ||
    team.marketing_director_id === rosterPersonId ||
    team.strategy_lead_id === rosterPersonId
  );
}

/**
 * Determines whether a client falls within a member's resolved access scope.
 * Specifically handles `assigned_team` for `strategy_lead` (covering all clients assigned
 * to the strategy lead OR to any member of the strategy team) and `senior_reviewer`
 * (covering all clients assigned to them or their design review team), without exposing
 * unrelated workspace clients that have no team involvement.
 */
export function isClientInMemberScope(params: {
  client: any;
  rosterPersonId?: string | null;
  role: RosterRole;
  accessScope?: AccessScope | string | null;
  rosterMembers?: Array<{
    id: string;
    role?: string | null;
    specialties?: string[] | null;
    is_active?: boolean | null;
  }>;
}): boolean {
  const { client, rosterPersonId, role, accessScope, rosterMembers = [] } = params;
  if (!client) return false;

  const effectiveScope = resolveEffectiveAccessScope(role, accessScope);

  if (effectiveScope === "workspace") {
    return true;
  }

  if (!rosterPersonId) return false;

  // Direct assignment on the client always grants scope access
  if (isDirectClientAssignee(client, rosterPersonId)) {
    return true;
  }

  const rawTeam = client.team_assignment || client.client_team_assignments;
  const team = Array.isArray(rawTeam) ? rawTeam[0] : rawTeam;

  if (effectiveScope === "assigned_team") {
    if (role === "strategy_lead") {
      const strategyTeamIds = new Set<string>([rosterPersonId]);
      for (const m of rosterMembers) {
        if (m.is_active === false) continue;
        const specs = Array.isArray(m.specialties) ? m.specialties : [];
        if (
          m.role === "strategy_lead" ||
          m.role === "strategist" ||
          specs.includes("strategy")
        ) {
          strategyTeamIds.add(m.id);
        }
      }
      if (team) {
        if (team.strategy_lead_id && strategyTeamIds.has(team.strategy_lead_id)) return true;
        if (team.strategy_reviewer_id && strategyTeamIds.has(team.strategy_reviewer_id)) return true;
        if (team.primary_strategist_id && strategyTeamIds.has(team.primary_strategist_id)) return true;
      }
      return false;
    }

    if (role === "senior_reviewer") {
      const designTeamIds = new Set<string>([rosterPersonId]);
      for (const m of rosterMembers) {
        if (m.is_active === false) continue;
        const specs = Array.isArray(m.specialties) ? m.specialties : [];
        if (
          m.role === "senior_reviewer" ||
          m.role === "designer" ||
          specs.includes("design")
        ) {
          designTeamIds.add(m.id);
        }
      }
      if (team) {
        if (team.design_reviewer_id && designTeamIds.has(team.design_reviewer_id)) return true;
        if (team.primary_designer_id && designTeamIds.has(team.primary_designer_id)) return true;
      }
      return false;
    }

    // Other roles with assigned_team: check if any member sharing their primary specialty is assigned
    const selfRecord = rosterMembers.find((m) => m.id === rosterPersonId);
    const selfSpecs = Array.isArray(selfRecord?.specialties) ? selfRecord!.specialties! : [];
    if (selfSpecs.length > 0 && team) {
      const teamIds = new Set<string>([rosterPersonId]);
      for (const m of rosterMembers) {
        if (m.is_active === false) continue;
        const specs = Array.isArray(m.specialties) ? m.specialties : [];
        if (selfSpecs.some((s) => specs.includes(s))) {
          teamIds.add(m.id);
        }
      }
      if (
        (team.primary_strategist_id && teamIds.has(team.primary_strategist_id)) ||
        (team.primary_copywriter_id && teamIds.has(team.primary_copywriter_id)) ||
        (team.primary_designer_id && teamIds.has(team.primary_designer_id)) ||
        (team.primary_video_editor_id && teamIds.has(team.primary_video_editor_id))
      ) {
        return true;
      }
    }
    return false;
  }

  // For assigned_clients or assigned_tasks: check if member has any task on this client
  const tasks = Array.isArray(client.tasks) ? client.tasks : [];
  if (
    tasks.some(
      (t: any) =>
        t.primary_assignee_id === rosterPersonId || t.reviewer_id === rosterPersonId
    )
  ) {
    return true;
  }

  return false;
}
