import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type UiState = { sidebarOpen: boolean };

const initialState: UiState = { sidebarOpen: true };

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
  },
});

export const { toggleSidebar, setSidebarOpen } = uiSlice.actions;
