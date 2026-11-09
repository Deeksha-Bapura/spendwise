/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { NavLinks } from "@/components/NavLinks";
import { RoleBadge } from "@/components/RoleBadge";

describe("<NavLinks />", () => {
  it("employee sees Dashboard, Transactions and Bank accounts, but not Admin", () => {
    render(<NavLinks role="EMPLOYEE" />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("href", "/transactions");
    expect(screen.getByRole("link", { name: "Bank accounts" })).toHaveAttribute("href", "/accounts");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("manager does not see Admin", () => {
    render(<NavLinks role="MANAGER" />);
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("finance admin sees Admin", () => {
    render(<NavLinks role="FINANCE_ADMIN" />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("marks the current page", () => {
    render(<NavLinks role="FINANCE_ADMIN" currentPath="/admin" />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});

describe("<RoleBadge />", () => {
  it("shows a readable role name", () => {
    render(<RoleBadge role="FINANCE_ADMIN" />);
    expect(screen.getByText("Finance admin")).toBeInTheDocument();
  });
});
