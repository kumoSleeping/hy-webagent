import { createContext, useContext } from "react";

export interface GroupPreviewInfo {
  botSlug: string;
  botDisplayName: string;
  channelId: string;
  channelDisplayName: string;
  selectSession: (sessionId: string) => void;
  returnToChat: () => void;
}

export const GroupPreviewContext = createContext<GroupPreviewInfo | null>(null);

export function useGroupPreview(): GroupPreviewInfo | null {
  return useContext(GroupPreviewContext);
}
