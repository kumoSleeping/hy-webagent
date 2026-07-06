export const WorkerParams = {
  type: "object" as const,
  properties: {
    task: {
      type: "string" as const,
      description: "实现任务描述。Worker 有完整文件读写权限。",
    },
    model: {
      type: "string" as const,
      description: "可选，指定模型如 'anthropic/claude-sonnet-4'。不指定则用当前模型。",
    },
    timeoutMs: {
      type: "number" as const,
      description: "超时毫秒，超时后中断并返回部分结果",
    },
  },
  required: ["task"],
};

/** Explorer / Searcher — lightweight, no model override exposed. */
export const LightWorkerParams = {
  type: "object" as const,
  properties: {
    task: {
      type: "string" as const,
      description: "任务描述。",
    },
    timeoutMs: {
      type: "number" as const,
      description: "超时毫秒，超时后中断并返回部分结果",
    },
  },
  required: ["task"],
};
