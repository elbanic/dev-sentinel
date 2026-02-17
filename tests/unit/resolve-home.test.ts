import * as os from 'os';
import * as path from 'path';
import { resolveHome } from '../../src/utils/resolve-home';

describe('resolveHome', () => {
  const home = os.homedir();

  it('should resolve ~/path to home directory + path', () => {
    expect(resolveHome('~/foo/bar')).toBe(path.join(home, 'foo/bar'));
  });

  it('should resolve bare ~ to home directory', () => {
    expect(resolveHome('~')).toBe(home);
  });

  it('should not change absolute paths', () => {
    expect(resolveHome('/absolute/path')).toBe('/absolute/path');
  });

  it('should not change relative paths without tilde', () => {
    expect(resolveHome('relative/path')).toBe('relative/path');
  });

  it('should not resolve tilde in the middle of a path', () => {
    expect(resolveHome('/some/~/path')).toBe('/some/~/path');
  });
});
