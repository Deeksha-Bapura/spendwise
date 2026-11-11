import { ACTIONS, can, navLinksFor, type Action, type Actor, type Role } from "@/modules/auth";

const ORG = "org_a";
const OTHER_ORG = "org_b";

const actor = (role: Role, overrides: Partial<Actor> = {}): Actor => ({
  id: `${role.toLowerCase()}_1`,
  orgId: ORG,
  teamId: "team_eng",
  role,
  ...overrides,
});

const employee = actor("EMPLOYEE");
const manager = actor("MANAGER");
const admin = actor("FINANCE_ADMIN", { teamId: "team_ops" });

const ownExpense = (a: Actor) => ({ orgId: ORG, ownerId: a.id, teamId: a.teamId });
const teammateExpense = { orgId: ORG, ownerId: "eli", teamId: "team_eng" };
const otherTeamExpense = { orgId: ORG, ownerId: "sam", teamId: "team_sales" };
const otherOrgExpense = { orgId: OTHER_ORG, ownerId: "zed", teamId: "team_eng" };

describe("can(): role-level permissions without a resource", () => {
  // Expected matrix: [action, employee, manager, finance admin]
  const matrix: [Action, boolean, boolean, boolean][] = [
    ["transaction:read", true, true, true],
    ["bank:connect", true, true, true],
    ["bank:sync", true, true, true], // no resource = "a bank of your own"
    ["expense:read", true, true, true],
    ["expense:create", true, true, true],
    ["expense:approve", false, false, false], // approving always needs a specific expense
    ["expense:reimburse", false, false, false],
    ["policy:read", true, true, true],
    ["policy:manage", false, false, true],
    ["audit:read", false, false, true],
    ["admin:access", false, false, true],
  ];

  it("covers every action", () => {
    expect(matrix.map(([a]) => a).sort()).toEqual([...ACTIONS].sort());
  });

  it.each(matrix)("%s → employee=%s manager=%s admin=%s", (action, e, m, a) => {
    expect(can(employee, action)).toBe(e);
    expect(can(manager, action)).toBe(m);
    expect(can(admin, action)).toBe(a);
  });
});

describe("can(): row-level rules", () => {
  it("employees read only their own expenses", () => {
    expect(can(employee, "expense:read", ownExpense(employee))).toBe(true);
    expect(can(employee, "expense:read", teammateExpense)).toBe(false);
  });

  it("managers read their team's expenses but not other teams'", () => {
    expect(can(manager, "expense:read", teammateExpense)).toBe(true);
    expect(can(manager, "expense:read", otherTeamExpense)).toBe(false);
  });

  it("managers approve teammates' expenses", () => {
    expect(can(manager, "expense:approve", teammateExpense)).toBe(true);
  });

  it("a manager cannot approve their own expense", () => {
    expect(can(manager, "expense:approve", ownExpense(manager))).toBe(false);
  });

  it("a manager cannot approve another team's expense", () => {
    expect(can(manager, "expense:approve", otherTeamExpense)).toBe(false);
  });

  it("a manager with no team can't approve anything", () => {
    const loneManager = actor("MANAGER", { teamId: null });
    expect(can(loneManager, "expense:approve", { orgId: ORG, ownerId: "x", teamId: null })).toBe(false);
  });

  it("employees can never approve, even a teammate's expense", () => {
    expect(can(employee, "expense:approve", teammateExpense)).toBe(false);
  });

  it("finance admins approve and reimburse org-wide, but never their own", () => {
    expect(can(admin, "expense:approve", otherTeamExpense)).toBe(true);
    expect(can(admin, "expense:reimburse", teammateExpense)).toBe(true);
    expect(can(admin, "expense:approve", ownExpense(admin))).toBe(false);
    expect(can(admin, "expense:reimburse", ownExpense(admin))).toBe(false);
  });
});

describe("can(): bank connections are personal", () => {
  it("only the owner can sync a bank, whatever their role", () => {
    for (const a of [employee, manager, admin]) {
      expect(can(a, "bank:sync", ownExpense(a))).toBe(true);
      expect(can(a, "bank:sync", teammateExpense)).toBe(false);
      expect(can(a, "bank:sync", otherTeamExpense)).toBe(false);
    }
  });
});

describe("can(): tenant isolation", () => {
  it.each([employee, manager, admin])("$role cannot touch another org's data", (a) => {
    for (const action of ACTIONS) {
      expect(can(a, action, otherOrgExpense)).toBe(false);
    }
  });
});

describe("navLinksFor()", () => {
  it("shows Approvals to approvers and Admin only to finance admins", () => {
    const labels = (r: Parameters<typeof navLinksFor>[0]) => navLinksFor(r).map((l) => l.label);
    expect(labels("EMPLOYEE")).toEqual(["Dashboard", "Transactions", "Expenses", "Bank accounts"]);
    expect(labels("MANAGER")).toEqual(["Dashboard", "Transactions", "Expenses", "Approvals", "Bank accounts"]);
    expect(labels("FINANCE_ADMIN")).toEqual(["Dashboard", "Transactions", "Expenses", "Approvals", "Bank accounts", "Admin"]);
  });
});
