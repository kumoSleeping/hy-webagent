export const SubagentParams = {
  type: "object" as const,
  properties: {
    task: {
      type: "string" as const,
      description: "任务描述。可以让他探索代码、搜索信息、写代码、跑命令等。",
    },
    model: {
      type: "string" as const,
      description: "可选。指定子代理使用的模型，如 'deepseek/deepseek-v4-flash'（轻量探索）、'deepseek/deepseek-v4-pro'（深度搜索）、或与你相同的模型（复杂任务）。不指定则默认与你相同。",
    },
    timeoutMs: {
      type: "number" as const,
      description: "超时毫秒，超时后中断并返回部分结果",
    },
  },
  required: ["task"],
};
