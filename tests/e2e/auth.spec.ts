import { expect, test } from "@playwright/test";
import { DEMO, signInAs } from "./helpers";

test.describe("signing in", () => {
  for (const who of ["employee", "manager", "finance"] as const) {
    test(`${who} can sign in and sees their name and role`, async ({ page }) => {
      await signInAs(page, who);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByTestId("profile-role")).toHaveText(DEMO[who].role);
    });
  }

  test("signs in with the email and password form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("manager@acme.test");
    await page.getByLabel("Password").fill("demo1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("current-user")).toHaveText(DEMO.manager.name);
  });

  test("shows an error for a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("employee@acme.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("signed-out users", () => {
  test("are redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("get 401 from the API", async ({ request }) => {
    const res = await request.get("/api/admin/health");
    expect(res.status()).toBe(401);
  });

  test("return to the page they asked for after signing in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
    await page.getByRole("button", { name: DEMO.finance.button }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  });

  test("can't be redirected off-site via ?next=", async ({ page }) => {
    await page.goto("/login?next=//evil.example.com");
    await page.getByRole("button", { name: DEMO.employee.button }).click();
    await expect(page).toHaveURL(/localhost:\d+\/dashboard$/);
  });
});

test.describe("role-based access", () => {
  test("employee has no Admin link and is blocked from /admin on the server", async ({ page }) => {
    await signInAs(page, "employee");
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await page.goto("/admin");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await expect(page.getByText("Recent audit log")).toHaveCount(0);

    const res = await page.request.get("/api/admin/health");
    expect(res.status()).toBe(403);
  });

  test("manager is blocked from /admin too", async ({ page }) => {
    await signInAs(page, "manager");
    const res = await page.request.get("/api/admin/health");
    expect(res.status()).toBe(403);
  });

  test("finance admin can open /admin and sees logins in the audit log", async ({ page }) => {
    await signInAs(page, "finance");
    await page.getByRole("link", { name: "Admin" }).click();
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByTestId("audit-table")).toContainText("auth.login");
    const res = await page.request.get("/api/admin/health");
    expect(res.status()).toBe(200);
  });
});

test("signing out ends the session", async ({ page }) => {
  await signInAs(page, "employee");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
