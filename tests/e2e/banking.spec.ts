import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

async function loadAllTransactions(page: Page) {
  const rows = page.getByTestId("transaction-row");
  await expect(rows.first()).toBeVisible();
  const more = page.getByRole("button", { name: "Load more" });
  while (await more.isVisible()) {
    const before = await rows.count();
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(before);
  }
  return rows;
}

test.describe("transactions", () => {
  test("employee sees only their own transactions, paged with Load more", async ({ page }) => {
    await signInAs(page, "employee");
    await page.getByRole("link", { name: "Transactions" }).click();
    await expect(page.getByTestId("transactions-scope")).toHaveText("Your card and bank transactions.");

    const rows = page.getByTestId("transaction-row");
    await expect(rows).toHaveCount(25); // first page
    await expect(page.getByRole("columnheader", { name: "Owner" })).toHaveCount(0);

    await loadAllTransactions(page);
    await expect(rows).toHaveCount(30); // all of Emma's demo transactions
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  test("manager sees their team's transactions but not other teams'", async ({ page }) => {
    await signInAs(page, "manager");
    await page.goto("/transactions");
    await loadAllTransactions(page);
    const owners = new Set(await page.getByTestId("transaction-owner").allTextContents());
    expect(owners).toEqual(new Set(["Emma Employee", "Eli Chen", "Marcus Manager"]));
  });

  test("finance admin sees the whole organization", async ({ page }) => {
    await signInAs(page, "finance");
    await page.goto("/transactions");
    await loadAllTransactions(page);
    const owners = new Set(await page.getByTestId("transaction-owner").allTextContents());
    expect(owners).toContain("Sam Patel");
  });

  test("the API never returns another user's data to an employee", async ({ page }) => {
    await signInAs(page, "employee");
    const res = await page.request.get("/api/transactions?limit=100");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { rows: { owner: { name: string } }[] };
    expect(new Set(body.rows.map((r) => r.owner.name))).toEqual(new Set(["Emma Employee"]));
  });
});

test.describe("bank accounts", () => {
  test("shows the seeded demo bank with its account, and a Connect button", async ({ page }) => {
    await signInAs(page, "employee");
    await page.getByRole("link", { name: "Bank accounts" }).click();
    const items = page.getByTestId("bank-items");
    await expect(items).toContainText("Demo Bank");
    await expect(items).toContainText("Demo data");
    await expect(items).toContainText("Corporate Card");
    await expect(items).toContainText("30 transactions");
    await expect(page.getByRole("button", { name: "Connect a bank" })).toBeVisible();
    // Demo banks aren't connected to Plaid, so there's nothing to sync.
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  });
});

test.describe("machine endpoints", () => {
  test("webhook without a valid Plaid signature is rejected", async ({ request }) => {
    const res = await request.post("/api/webhooks/plaid", {
      data: { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "x" },
    });
    expect(res.status()).toBe(401);
  });

  test("cron endpoint requires the secret", async ({ request }) => {
    expect((await request.get("/api/cron/webhooks")).status()).toBe(401);
    expect(
      (await request.get("/api/cron/webhooks", { headers: { authorization: "Bearer wrong-secret-0000000" } })).status(),
    ).toBe(401);
  });

  test("exchange requires an Idempotency-Key", async ({ page }) => {
    await signInAs(page, "employee");
    const res = await page.request.post("/api/plaid/exchange", { data: { publicToken: "public-sandbox-x" } });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Idempotency-Key/);
  });
});
