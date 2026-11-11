import {
  availableActions,
  canTransition,
  EXPENSE_ACTIONS,
  EXPENSE_STATUSES,
  InvalidTransitionError,
  nextStatus,
  suggestCategory,
  type ExpenseAction,
  type ExpenseStatus,
} from "@/modules/expenses";

// The complete transition table: every (status, action) pair is listed,
// so adding a status or action without deciding its rules fails this test.
const EXPECTED: Record<ExpenseStatus, Partial<Record<ExpenseAction, ExpenseStatus | null>>> = {
  DRAFT: { edit: "DRAFT", submit: "SUBMITTED", discard: null },
  SUBMITTED: { approve: "APPROVED", reject: "REJECTED" },
  APPROVED: {},
  REJECTED: { edit: "DRAFT", submit: "SUBMITTED" },
  REIMBURSED: {},
};

describe("expense workflow", () => {
  for (const from of EXPENSE_STATUSES) {
    for (const action of EXPENSE_ACTIONS) {
      const allowed = action in EXPECTED[from];
      it(`${from} --${action}--> ${allowed ? String(EXPECTED[from][action]) : "not allowed"}`, () => {
        expect(canTransition(from, action)).toBe(allowed);
        if (allowed) expect(nextStatus(from, action)).toBe(EXPECTED[from][action]);
        else expect(() => nextStatus(from, action)).toThrow(InvalidTransitionError);
      });
    }
  }

  it("approved and reimbursed expenses are final: nobody can change them", () => {
    for (const status of ["APPROVED", "REIMBURSED"] as const) {
      expect(availableActions(status, "submitter")).toEqual([]);
      expect(availableActions(status, "approver")).toEqual([]);
    }
  });

  it("submitters and approvers get different actions", () => {
    expect(availableActions("DRAFT", "submitter")).toEqual(["edit", "submit", "discard"]);
    expect(availableActions("DRAFT", "approver")).toEqual([]);
    expect(availableActions("SUBMITTED", "submitter")).toEqual([]);
    expect(availableActions("SUBMITTED", "approver")).toEqual(["approve", "reject"]);
    expect(availableActions("REJECTED", "submitter")).toEqual(["edit", "submit"]);
  });

  it("explains invalid transitions in plain words", () => {
    expect(() => nextStatus("APPROVED", "edit")).toThrow("Can't edit an expense that is approved");
  });
});

describe("suggestCategory", () => {
  it.each([
    ["FOOD_AND_DRINK", "Meals"],
    ["TRAVEL", "Travel"],
    ["TRANSPORTATION", "Transportation"],
    ["GENERAL_SERVICES", "Software"],
    ["RENT_AND_UTILITIES", "Other"],
    [null, "Other"],
  ])("%s → %s", (plaid, expected) => {
    expect(suggestCategory(plaid)).toBe(expected);
  });
});
