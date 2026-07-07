import fs from "node:fs";
import path from "node:path";

export type UsageSource = "chat" | "subagent";

export interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  costUsd: number;
}

export interface DailyUsageFile {
  date: string;
  userId: string;
  displayName: string;
  models: Record<string, ModelUsage>;
  totals: ModelUsage;
  bySource: Record<UsageSource, ModelUsage>;
}

function emptyUsage(): ModelUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, costUsd: 0 };
}

function normalizeUsage(raw?: Partial<ModelUsage>): ModelUsage {
  return {
    input: raw?.input ?? 0,
    output: raw?.output ?? 0,
    cacheRead: raw?.cacheRead ?? 0,
    cacheWrite: raw?.cacheWrite ?? 0,
    turns: raw?.turns ?? 0,
    costUsd: raw?.costUsd ?? 0,
  };
}

function addUsage(
  target: ModelUsage,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  costUsd: number,
  turns = 1
) {
  target.input += input;
  target.output += output;
  target.cacheRead += cacheRead;
  target.cacheWrite += cacheWrite;
  target.turns += turns;
  target.costUsd += costUsd;
}

function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDailyFile(raw: DailyUsageFile): DailyUsageFile {
  const totals = normalizeUsage(raw.totals);
  const bySource = {
    chat: normalizeUsage(raw.bySource?.chat),
    subagent: normalizeUsage(raw.bySource?.subagent),
  };
  const models: Record<string, ModelUsage> = {};
  for (const [key, value] of Object.entries(raw.models ?? {})) {
    models[key] = normalizeUsage(value);
  }
  return { ...raw, totals, bySource, models };
}

export class UsageRecorder {
  private usageRoot: string;
  private writeBuffer = new Map<string, DailyUsageFile>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hasShutdownHook = false;

  private static readonly WRITE_DEBOUNCE_MS = 5000;

  constructor(usageRoot?: string) {
    this.usageRoot = usageRoot ?? path.join(process.cwd(), "..", "data", "usage");
  }

  private userDir(userId: string): string {
    return path.join(this.usageRoot, userId);
  }

  private dailyPath(userId: string, date: string): string {
    return path.join(this.userDir(userId), `${date}.json`);
  }

  private readDaily(userId: string, date: string, displayName: string): DailyUsageFile {
    const filePath = this.dailyPath(userId, date);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DailyUsageFile;
      return normalizeDailyFile(raw);
    } catch {
      return {
        date,
        userId,
        displayName,
        models: {},
        totals: emptyUsage(),
        bySource: { chat: emptyUsage(), subagent: emptyUsage() },
      };
    }
  }

  private persistDaily(file: DailyUsageFile): void {
    fs.mkdirSync(this.userDir(file.userId), { recursive: true });
    fs.writeFileSync(this.dailyPath(file.userId, file.date), JSON.stringify(file, null, 2));
  }

  private scheduleWrite(file: DailyUsageFile): void {
    const key = `${file.userId}:${file.date}`;
    this.writeBuffer.set(key, file);

    const existing = this.writeTimers.get(key);
    if (existing) clearTimeout(existing);

    this.writeTimers.set(key, setTimeout(() => {
      this.writeTimers.delete(key);
      const f = this.writeBuffer.get(key);
      if (f) {
        this.writeBuffer.delete(key);
        this.persistDaily(f);
      }
    }, UsageRecorder.WRITE_DEBOUNCE_MS));

    // Register shutdown hook once
    if (!this.hasShutdownHook) {
      this.hasShutdownHook = true;
      const flush = () => this.flush();
      process.on("beforeExit", flush);
      process.on("SIGTERM", flush);
      process.on("SIGINT", flush);
    }
  }

  /** Force-flush all pending buffered writes. Call on graceful shutdown. */
  flush(): void {
    for (const [key, timer] of this.writeTimers) {
      clearTimeout(timer);
      this.writeTimers.delete(key);
      const file = this.writeBuffer.get(key);
      if (file) {
        this.writeBuffer.delete(key);
        this.persistDaily(file);
      }
    }
  }

  record(params: {
    userId: string;
    displayName: string;
    provider: string;
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    source: UsageSource;
    turns?: number;
    date?: string;
  }): DailyUsageFile {
    const date = params.date ?? utcDateString();
    const modelKey = `${params.provider}/${params.model}`;
    const turnCount = params.turns ?? 1;
    const file = this.readDaily(params.userId, date, params.displayName);
    file.displayName = params.displayName;

    if (!file.models[modelKey]) file.models[modelKey] = emptyUsage();
    addUsage(
      file.models[modelKey],
      params.input,
      params.output,
      params.cacheRead,
      params.cacheWrite,
      params.costUsd,
      turnCount
    );
    addUsage(
      file.totals,
      params.input,
      params.output,
      params.cacheRead,
      params.cacheWrite,
      params.costUsd,
      turnCount
    );
    addUsage(
      file.bySource[params.source],
      params.input,
      params.output,
      params.cacheRead,
      params.cacheWrite,
      params.costUsd,
      turnCount
    );

    this.scheduleWrite(file);
    return file;
  }

  getDaily(userId: string, date: string): DailyUsageFile | null {
    const filePath = this.dailyPath(userId, date);
    try {
      return normalizeDailyFile(JSON.parse(fs.readFileSync(filePath, "utf-8")) as DailyUsageFile);
    } catch {
      return null;
    }
  }

  getRange(userId: string, from: string, to: string): DailyUsageFile[] {
    const dir = this.userDir(userId);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    return files
      .map((f) => f.replace(/\.json$/, ""))
      .filter((d) => d >= from && d <= to)
      .sort()
      .map((date) => this.getDaily(userId, date))
      .filter((f): f is DailyUsageFile => f !== null);
  }

  listDailyDates(userId: string): string[] {
    const dir = this.userDir(userId);
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();
    } catch {
      return [];
    }
  }

  getAllUsersDaily(date: string): DailyUsageFile[] {
    let userIds: string[] = [];
    try {
      userIds = fs.readdirSync(this.usageRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
    return userIds
      .map((userId) => this.getDaily(userId, date))
      .filter((f): f is DailyUsageFile => f !== null);
  }
}
