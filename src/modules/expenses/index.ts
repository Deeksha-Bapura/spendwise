// Public, client-safe API of the expenses module: the workflow rules.
// Database operations live in "@/modules/expenses/server".
export {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  EXPENSE_ACTIONS,
  nextStatus,
  canTransition,
  availableActions,
  performedBy,
  suggestCategory,
  InvalidTransitionError,
} from "./workflow";
export type { ExpenseStatus, ExpenseAction, ExpenseCategory, ActorRelation } from "./workflow";
