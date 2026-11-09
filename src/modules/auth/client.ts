"use client";
import { createAuthClient } from "better-auth/react";

// Same-origin: the auth API lives at /api/auth/* in this app.
export const authClient = createAuthClient();
