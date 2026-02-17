import * as path from 'path';
import * as os from 'os';

/**
 * Resolve tilde (~) in a path to the user's home directory.
 */
export function resolveHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}
