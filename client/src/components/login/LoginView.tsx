import { useState, type FormEvent, type KeyboardEvent } from "react";
import { PlatformSignature } from "../common/PlatformSignature";
import { useAuthStore } from "../../stores/authStore";

export function LoginView() {
  const [apiKey, setApiKey] = useState("");
  const { login, isLoading, error, clearError } = useAuthStore();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    await login(apiKey.trim());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit(e as unknown as FormEvent);
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--pi-bg)] px-4">
      <div className="pi-glass relative w-full max-w-md p-8 pt-12">
        <div className="pi-corner-badge">SIGN IN</div>
        <div className="mb-8">
          <h1 className="text-[28px] font-black leading-none tracking-tight uppercase text-[var(--pi-text)]">
            HY-Webagent
          </h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); if (error) clearError(); }}
            onKeyDown={handleKeyDown}
            placeholder="sk-hyw-..."
            autoFocus
            className="w-full border border-[var(--pi-line)] bg-white px-3.5 py-2.5 text-base text-[var(--pi-text)] outline-none transition focus:border-[var(--pi-line)]"
          />
          {error && <p className="text-xs text-[#dc2626] font-mono">{error}</p>}
          <button
            type="submit"
            disabled={isLoading || !apiKey.trim()}
            className="flex h-10 w-full items-center justify-center bg-[var(--pi-text)] text-sm font-bold uppercase tracking-wider text-white transition-all hover:bg-[#1c1c1e] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? "Verifying..." : "Go!"}
          </button>
        </form>
      </div>
      <PlatformSignature />
    </div>
  );
}
