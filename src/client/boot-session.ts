/**
 * Boot-time session restore (P2-G-1). Share fragment first, then autosave.
 */
import { migrateSessionDoc } from '@shared/session';
import { applySessionDoc, loadSession, resolveShareFragment, type RestoredSession } from './session';

export interface BootSessionOptions {
  readonly hash: string;
  readonly testMode: boolean;
  readonly confirmOverwrite: () => Promise<boolean> | boolean;
  readonly fetchServerSession: (id: string) => Promise<unknown>;
}

export async function resolveBootSession(opts: BootSessionOptions): Promise<RestoredSession | null> {
  const shareDoc = await resolveShareFragment(opts.hash, {
    hasExistingAutosave: loadSession() !== null,
    confirmOverwrite: () =>
      opts.testMode ? true : opts.confirmOverwrite(),
    fetchServerSession: async (id) => {
      const raw = await opts.fetchServerSession(id);
      if (raw == null) return null;
      return migrateSessionDoc(raw);
    },
  });
  if (shareDoc) {
    try {
      return applySessionDoc(shareDoc);
    } catch {
      return null;
    }
  }
  const saved = loadSession();
  if (!saved) return null;
  try {
    return applySessionDoc(saved);
  } catch {
    return null;
  }
}
