#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const agentDir = process.argv[2] || path.join(os.homedir(), ".pi", "agent");
const modelsPath = path.join(agentDir, "models.json");
const settingsPath = path.join(agentDir, "settings.json");

function writeJsonAtomic(filePath, value, mode) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, mode);
}

const modelsConfig = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
const sorux = modelsConfig.providers?.soruxgpt;
if (sorux) {
  const grok = Array.isArray(sorux.models)
    ? sorux.models.find((model) => model?.id === "grok-4.5")
    : undefined;
  const modelOverride = grok
    ? {
        name: grok.name,
        reasoning: grok.reasoning,
        input: grok.input,
        cost: grok.cost,
        contextWindow: grok.contextWindow,
        maxTokens: grok.maxTokens,
        thinkingLevelMap: grok.thinkingLevelMap,
        compat: {
          supportsLongCacheRetention: false,
          ...(grok.compat ?? {}),
        },
      }
    : undefined;

  modelsConfig.providers.xai = {
    ...(modelsConfig.providers.xai ?? {}),
    baseUrl: sorux.baseUrl,
    apiKey: sorux.apiKey,
    headers: sorux.headers,
    ...(modelOverride ? { modelOverrides: { "grok-4.5": modelOverride } } : {}),
  };
  delete modelsConfig.providers.soruxgpt;
  writeJsonAtomic(modelsPath, modelsConfig, 0o600);
}

if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (settings.defaultProvider === "soruxgpt") {
    settings.defaultProvider = "xai";
    writeJsonAtomic(settingsPath, settings, 0o600);
  }
}

console.log(sorux ? "Migrated Sorux endpoint onto PI built-in xai provider" : "No soruxgpt provider migration needed");
