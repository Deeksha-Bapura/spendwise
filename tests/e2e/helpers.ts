import { expect, type Page } from "@playwright/test";

export const DEMO = {
  employee: { button: "Sign in as Employee", name: "Emma Employee", role: "Employee" },
  manager: { button: "Sign in as Manager", name: "Marcus Manager", role: "Manager" },
  finance: { button: "Sign in as Finance Admin", name: "Fiona Finance", role: "Finance admin" },
} as const;

export async function signInAs(page: Page, who: keyof typeof DEMO, path = "/login") {
  await page.goto(path);
  await page.getByRole("button", { name: DEMO[who].button }).click();
  await expect(page.getByTestId("current-user")).toHaveText(DEMO[who].name);
}
