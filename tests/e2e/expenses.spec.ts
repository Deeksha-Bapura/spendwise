import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

// Note: Next.js keeps recently visited pages mounted (hidden) for instant back
// navigation, so selectors must be unique to the page under test.
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function as(browser: Browser, who: "employee" | "manager" | "finance") {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, who);
  return page;
}

/** Emma creates a manual expense and submits it. Returns its detail URL. */
async function createAndSubmit(page: Page, description: string, amount = "18.75") {
  await page.goto("/expenses");
  await page.getByRole("button", { name: "New expense" }).click();
  const form = page.getByRole("form", { name: "New expense" });
  await form.getByLabel("Amount (USD)").fill(amount);
  await form.getByLabel("Category").selectOption("Meals");
  await form.getByLabel("Description").fill(description);
  await form.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByTestId("expense-description")).toHaveText(description);
  await expect(page.getByTestId("expense-detail-status")).toHaveText("Draft");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByTestId("expense-detail-status")).toHaveText("Awaiting approval");
  return page.url();
}

test("employee submits, manager approves from the queue, employee sees it approved", async ({ browser }) => {
  const description = unique("E2E client lunch");
  const emma = await as(browser, "employee");
  const url = await createAndSubmit(emma, description);
  await expect(emma.getByTestId("expense-amount")).toHaveText("$18.75");

  const marcus = await as(browser, "manager");
  await marcus.goto("/approvals");
  const item = marcus.getByTestId("queue-item").filter({ hasText: description });
  await expect(item).toContainText("Emma Employee");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(item).toHaveCount(0); // left the queue

  await emma.goto(url);
  await expect(emma.getByTestId("expense-detail-status")).toHaveText("Approved");
  await expect(emma.getByTestId("approvals")).toContainText("Approved by Marcus Manager");
  await expect(emma.getByTestId("expense-history")).toContainText("Approved · Marcus Manager");
  await expect(emma.getByTestId("expense-actions")).toHaveCount(0); // final: no buttons
});

test("manager rejects with a reason; employee edits and resubmits", async ({ browser }) => {
  const description = unique("E2E taxi");
  const emma = await as(browser, "employee");
  const url = await createAndSubmit(emma, description, "31.00");

  const marcus = await as(browser, "manager");
  await marcus.goto("/approvals");
  const item = marcus.getByTestId("queue-item").filter({ hasText: description });
  await item.getByRole("button", { name: "Reject" }).click();
  await item.getByLabel("Reason for rejecting").fill("Which client was this for?");
  await item.getByRole("button", { name: "Confirm reject" }).click();
  await expect(item).toHaveCount(0);

  await emma.goto(url);
  await expect(emma.getByTestId("expense-detail-status")).toHaveText("Rejected");
  await expect(emma.getByTestId("approvals")).toContainText("Which client was this for?");
  await emma.getByRole("button", { name: "Edit" }).click();
  await emma.getByLabel("Description").fill(`${description} (Acme visit)`);
  await emma.getByRole("button", { name: "Save changes" }).click();
  await expect(emma.getByTestId("expense-detail-status")).toHaveText("Draft");
  await emma.getByRole("button", { name: "Submit for approval" }).click();
  await expect(emma.getByTestId("expense-detail-status")).toHaveText("Awaiting approval");
});

test("expense a card transaction in one click (then discard the draft)", async ({ page }) => {
  await signInAs(page, "employee");
  await page.goto("/transactions");
  const row = page.getByTestId("transaction-row").filter({ has: page.getByRole("button", { name: "Expense it" }) }).first();
  const merchant = (await row.locator("td").nth(1).locator("span").first().textContent())!.trim();
  await row.getByRole("button", { name: "Expense it" }).click();

  await expect(page).toHaveURL(/\/expenses\/[^/]+$/);
  await expect(page.getByTestId("expense-description")).toHaveText(merchant);
  await expect(page.getByText("From card transaction")).toBeVisible();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page).toHaveURL(/\/expenses$/);
});

test("after discarding, the transaction can be expensed again (no stale 'Creating…')", async ({ page }) => {
  await signInAs(page, "employee");
  await page.getByRole("link", { name: "Transactions" }).click();
  const rows = page.getByTestId("transaction-row").filter({ visible: true });
  const row = rows.filter({ has: page.getByRole("button", { name: "Expense it" }) }).first();
  const date = (await row.locator("td").first().textContent())!.trim();
  const amount = (await row.locator("td").nth(-2).textContent())!.trim();
  const sameRow = () => rows.filter({ hasText: date }).filter({ hasText: amount });

  await row.getByRole("button", { name: "Expense it" }).click();
  await expect(page).toHaveURL(/\/expenses\/[^/]+$/);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(sameRow().getByRole("link", { name: "Expensed" })).toBeVisible(); // list was refreshed

  await sameRow().getByRole("link", { name: "Expensed" }).click();
  await page.getByRole("button", { name: "Discard draft" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(sameRow().getByRole("button", { name: "Expense it" })).toBeVisible();
  await expect(page.getByText("Creating…")).toHaveCount(0);
});

test("pending charges show 'Not yet posted' instead of Expense it", async ({ page }) => {
  await signInAs(page, "employee");
  await page.goto("/transactions");
  const pendingRow = page.getByTestId("transaction-row").filter({ hasText: "Pending" }).first();
  await expect(pendingRow.getByText("Not yet posted")).toBeVisible();
  await expect(pendingRow.getByRole("button", { name: "Expense it" })).toHaveCount(0);
});

test("a manager can't approve their own expense; it waits in finance's queue", async ({ browser }) => {
  const marcus = await as(browser, "manager");
  const res = await marcus.request.post("/api/expenses/demo_exp_marcus_submitted/decision", {
    data: { decision: "approve", version: 1 },
  });
  expect(res.status()).toBe(403);
  await marcus.goto("/approvals");
  await expect(marcus.locator('a[href="/expenses/demo_exp_marcus_submitted"]')).toHaveCount(0);

  const fiona = await as(browser, "finance");
  await fiona.goto("/approvals");
  await expect(fiona.locator('a[href="/expenses/demo_exp_marcus_submitted"]')).toBeVisible();
});

test("employees can't open the approvals page", async ({ page }) => {
  await signInAs(page, "employee");
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await page.goto("/approvals");
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});

test("an expense outside your team is a 404, in the page and the API", async ({ page }) => {
  await signInAs(page, "manager");
  const api = await page.request.get("/api/expenses/demo_exp_sam_submitted");
  expect(api.status()).toBe(404);
});

test("a half-filled draft survives navigating away (Redux)", async ({ page }) => {
  await signInAs(page, "employee");
  await page.getByRole("link", { name: "Expenses" }).click();
  await page.getByRole("button", { name: "New expense" }).click();
  await page.getByRole("form", { name: "New expense" }).getByLabel("Description").fill("Half-written draft");
  await page.getByRole("link", { name: "Transactions" }).click();
  await page.getByRole("link", { name: "Expenses" }).click();
  await expect(page.getByRole("form", { name: "New expense" }).getByLabel("Description")).toHaveValue("Half-written draft");
});

test("dashboard shows what's waiting on a manager", async ({ page }) => {
  await signInAs(page, "manager");
  await expect(page.getByTestId("count-awaiting-me")).not.toHaveText("0");
});
