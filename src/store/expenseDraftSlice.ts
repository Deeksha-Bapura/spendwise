import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Client-only state for the "New expense" form. It lives in Redux, not the
 * component, so a half-filled draft survives navigating away and back. It's
 * never sent anywhere until the user saves it: server data stays in TanStack Query.
 */
export type ExpenseDraft = {
  open: boolean;
  amount: string;
  category: string;
  description: string;
  spentAt: string; // YYYY-MM-DD
  idempotencyKey: string | null; // one key per draft, so a double-click creates one expense
};

const initialState: ExpenseDraft = {
  open: false,
  amount: "",
  category: "Meals",
  description: "",
  spentAt: "",
  idempotencyKey: null,
};

export const expenseDraftSlice = createSlice({
  name: "expenseDraft",
  initialState,
  reducers: {
    openDraft: (state, action: PayloadAction<{ today: string; idempotencyKey: string }>) => {
      state.open = true;
      state.spentAt ||= action.payload.today;
      state.idempotencyKey ??= action.payload.idempotencyKey;
    },
    closeDraft: (state) => {
      state.open = false;
    },
    updateDraft: (state, action: PayloadAction<Partial<Pick<ExpenseDraft, "amount" | "category" | "description" | "spentAt">>>) => {
      Object.assign(state, action.payload);
    },
    resetDraft: () => initialState,
  },
});

export const { openDraft, closeDraft, updateDraft, resetDraft } = expenseDraftSlice.actions;
