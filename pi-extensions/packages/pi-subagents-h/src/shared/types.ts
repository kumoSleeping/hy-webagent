import type { Message } from "@earendil-works/pi-ai";

export interface SingleResult {
  task: string;
  exitCode: number;
  messages: Message[];
  usage: Usage;
  model?: string;
  error?: string;
  finalOutput?: string;
  interrupted?: boolean;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";
