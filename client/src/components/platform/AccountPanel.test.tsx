import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../stores/authStore";
import { AccountPanel } from "./AccountPanel";

vi.mock("../../hooks/useAccountProfileSync", () => ({
  fetchAccountProfile: vi.fn(async () => undefined),
}));

vi.mock("../../lib/api", () => ({
  apiGet: vi.fn(async (path: string) =>
    path === "/api/token/usage" ? { costTodayUsd: 0 } : { groups: [] }
  ),
  apiPost: vi.fn(),
}));

describe("AccountPanel", () => {
  beforeEach(() => {
    useAuthStore.setState({
      username: "kumo",
      displayName: "Kumo",
      role: "admin",
      budgetUsd: 10,
      budgetUsedUsd: 2,
      budgetRemainingUsd: 8,
      budgetUnlimited: false,
    });
  });

  it("renders group history and logout as descriptive list rows", async () => {
    const { container } = render(
      <MemoryRouter>
        <AccountPanel />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("群聊记录")).toBeInTheDocument());
    expect(screen.getByText("查看已保存群聊中的工作进度")).toBeInTheDocument();
    expect(screen.getByText("退出登录")).toBeInTheDocument();
    expect(screen.getByText("清除当前登录并返回登录页")).toBeInTheDocument();
    expect(container.querySelector(".pi-panel-footer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /群聊记录/ }));
    expect(await screen.findByText("查看群聊中的工作进度")).toBeInTheDocument();
  });
});
