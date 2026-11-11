import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { expenseDraftSlice } from "./expenseDraftSlice";
import { uiSlice } from "./uiSlice";

// One store per request/tab (created in Providers), never a module-level singleton,
// so server renders never share state between users.
export function makeStore() {
  return configureStore({ reducer: { ui: uiSlice.reducer, expenseDraft: expenseDraftSlice.reducer } });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
