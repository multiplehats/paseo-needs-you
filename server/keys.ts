import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Provider, PROVIDERS } from "../shared/jev";

export interface SavedDetection {
  provider: Provider | null;
  keys: Partial<Record<Provider, string>>;
}

export interface KeyStore {
  read(): Promise<SavedDetection>;
  write(saved: SavedDetection): Promise<void>;
}

// Plugin settings can be read by every connected app, so the key lives in its own file instead.
export function defaultKeyPath(env: Record<string, string | undefined> = process.env) {
  return join(env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-secrets", "needs-you.json");
}

function parse(raw: string): SavedDetection {
  const value = JSON.parse(raw) as Partial<SavedDetection> | null;
  const provider = PROVIDERS.find((known) => known === value?.provider) ?? null;
  return { provider, keys: value?.keys && typeof value.keys === "object" ? value.keys : {} };
}

export function fileKeyStore(path = defaultKeyPath()): KeyStore {
  return {
    async read() {
      try {
        return parse(await readFile(path, "utf8"));
      } catch {
        return { provider: null, keys: {} };
      }
    },
    async write(saved) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}
