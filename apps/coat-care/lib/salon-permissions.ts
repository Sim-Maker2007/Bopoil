export const WORKSPACE_PERMISSIONS = [
  "calendar", "clients", "messages", "services", "team", "workforce", "inventory", "checkout", "finance", "reports", "settings",
] as const;

export type WorkspacePermission = typeof WORKSPACE_PERMISSIONS[number];

export const PERMISSION_LABELS: Record<WorkspacePermission, { label: string; description: string }> = {
  calendar: { label: "Appointments & calendar", description: "View and manage appointments." },
  clients: { label: "Clients & pets", description: "View profiles, notes, photos, and history." },
  messages: { label: "Messages", description: "Communicate with clients." },
  services: { label: "Services & pricing", description: "Edit the menu, timing, and prices." },
  team: { label: "Team & schedules", description: "Manage teammates, skills, and availability." },
  workforce: { label: "Timesheets", description: "View, correct, and approve worked hours." },
  inventory: { label: "Inventory", description: "View and adjust products in stock." },
  checkout: { label: "Checkout", description: "Create payment links and collect appointment payments." },
  finance: { label: "Accounting", description: "View ledgers, expenses, receipts, and accounting exports." },
  reports: { label: "Reports", description: "View salon performance indicators." },
  settings: { label: "Settings", description: "Change salon settings." },
};

const defaults: Record<string, WorkspacePermission[]> = {
  owner: [...WORKSPACE_PERMISSIONS],
  manager: [...WORKSPACE_PERMISSIONS],
  receptionist: ["calendar", "clients", "messages", "team", "inventory", "checkout"],
  groomer: ["calendar", "clients", "messages", "workforce", "inventory"],
  bather: ["calendar", "clients", "workforce", "inventory"],
  accountant: ["workforce", "checkout", "finance", "reports"],
};

export function defaultPermissions(role: string) {
  return defaults[role] || [];
}

export function parsePermissions(role: string, value?: string | null): WorkspacePermission[] {
  if (role === "owner") return [...WORKSPACE_PERMISSIONS];
  if (value == null) return [...defaultPermissions(role)];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [...defaultPermissions(role)];
    if (role === "receptionist") {
      // Migrate legacy receptionist grants: the former broad "finance" flag was
      // used for checkout, but must no longer expose bookkeeping.
      const migrated = new Set(parsed);
      if (migrated.delete("finance")) migrated.add("checkout");
      return WORKSPACE_PERMISSIONS.filter((permission) => migrated.has(permission));
    }
    return WORKSPACE_PERMISSIONS.filter((permission) => parsed.includes(permission));
  } catch {
    return [...defaultPermissions(role)];
  }
}

export function sanitizePermissions(value: unknown): WorkspacePermission[] {
  if (!Array.isArray(value)) return [];
  return WORKSPACE_PERMISSIONS.filter((permission) => value.includes(permission));
}
