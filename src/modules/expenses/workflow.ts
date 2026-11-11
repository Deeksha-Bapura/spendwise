/**
 * The expense lifecycle as data. Every status change in the app goes through
 * `nextStatus`, so there is exactly one place that defines what's allowed.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──(Phase 3: ledger pays)──▶ REIMBURSED
 *     ▲                   │
 *     └─── edit ◀── REJECTED ◀──reject──┘   (resubmit after fixing)
 *
 * Pure functions, no I/O: unit-tested exhaustively.
 */

export const EXPENSE_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_ACTIONS = ["edit", "submit", "approve", "reject", "discard"] as const;
export type ExpenseAction = (typeof EXPENSE_ACTIONS)[number];

/** Who performs an action, relative to the expense. Role checks live in rbac.ts. */
export type ActorRelation = "submitter" | "approver";

type Rule = { from: readonly ExpenseStatus[]; to: ExpenseStatus | null; by: ActorRelation };

const RULES: Record<ExpenseAction, Rule> = {
  edit: { from: ["DRAFT", "REJECTED"], to: "DRAFT", by: "submitter" },
  submit: { from: ["DRAFT", "REJECTED"], to: "SUBMITTED", by: "submitter" },
  approve: { from: ["SUBMITTED"], to: "APPROVED", by: "approver" },
  reject: { from: ["SUBMITTED"], to: "REJECTED", by: "approver" },
  discard: { from: ["DRAFT"], to: null, by: "submitter" }, // null = deleted
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly action: ExpenseAction,
    public readonly from: ExpenseStatus,
  ) {
    super(`Can't ${action} an expense that is ${from.toLowerCase()}`);
    this.name = "InvalidTransitionError";
  }
}

/** The status after `action`, or throws if `action` isn't allowed from `from`. */
export function nextStatus(from: ExpenseStatus, action: ExpenseAction): ExpenseStatus | null {
  const rule = RULES[action];
  if (!rule.from.includes(from)) throw new InvalidTransitionError(action, from);
  return rule.to;
}

export function canTransition(from: ExpenseStatus, action: ExpenseAction): boolean {
  return RULES[action].from.includes(from);
}

export function performedBy(action: ExpenseAction): ActorRelation {
  return RULES[action].by;
}

/** Actions available to the submitter / an approver for an expense in `status`. */
export function availableActions(status: ExpenseStatus, relation: ActorRelation): ExpenseAction[] {
  return EXPENSE_ACTIONS.filter((a) => RULES[a].by === relation && RULES[a].from.includes(status));
}

export const EXPENSE_CATEGORIES = [
  "Meals",
  "Travel",
  "Lodging",
  "Transportation",
  "Software",
  "Office supplies",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** A starting guess from Plaid's category. Phase 2 replaces this with an LLM, measured against it. */
export function suggestCategory(plaidCategory: string | null): ExpenseCategory {
  switch (plaidCategory) {
    case "FOOD_AND_DRINK":
      return "Meals";
    case "TRAVEL":
      return "Travel";
    case "TRANSPORTATION":
      return "Transportation";
    case "GENERAL_SERVICES":
      return "Software";
    case "GENERAL_MERCHANDISE":
      return "Office supplies";
    default:
      return "Other";
  }
}
