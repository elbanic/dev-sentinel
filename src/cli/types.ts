import type { LLMProvider } from '../types/index';
import type { SqliteStore } from '../storage/sqlite-store';
import type { VectorStore } from '../storage/vector-store';

export interface CreateProgramDeps {
  sqliteStore: SqliteStore;
  vectorStore: VectorStore;
  llmProvider: LLMProvider;
  stdin?: string;
  maxAdvicesPerSession?: number;
  frustrationThreshold?: number;
  enabled?: boolean;
  configDir?: string;
}

export interface WriteFns {
  write: (msg: string) => void;
  writeErr: (msg: string) => void;
}
