import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationStore, resetNotificationStoreForTests } from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    resetNotificationStoreForTests();
  });

  it("dedupes identical visible notifications", () => {
    const { notify } = useNotificationStore.getState();
    notify("Jina 搜索 & 阅读已就绪", "info");
    notify("Jina 搜索 & 阅读已就绪", "info");

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it("allows the same message again after dismiss", () => {
    useNotificationStore.getState().notify("hello", "info");
    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().remove(id);
    useNotificationStore.getState().notify("hello", "info");

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});
