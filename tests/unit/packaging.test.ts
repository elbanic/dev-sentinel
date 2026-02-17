/**
 * Unit Tests for Phase 8.1: npm Package Setup
 *
 * These tests verify that the dev-sentinel package is correctly configured
 * for npm distribution. They validate:
 *
 *   1. package.json structure (files, prepublishOnly, bin, engines, name)
 *   2. Shebang line in src/cli.ts (source)
 *   3. Build output correctness (dist/cli.js shebang + existence)
 *   4. npm pack output (only dist/ and package.json shipped, no src/ or tests/)
 *
 * These tests read files directly from disk and run npm commands.
 * They are static verification tests -- no mocks needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const SRC_CLI_PATH = path.join(PROJECT_ROOT, 'src', 'cli.ts');
const DIST_CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');

/**
 * Helper: read and parse package.json from the project root.
 */
function readPackageJson(): Record<string, unknown> {
  const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Helper: read the first line of a file.
 */
function readFirstLine(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return content;
  return content.substring(0, firstNewline);
}

// =============================================================================
// 1. package.json structure tests
// =============================================================================
describe('Phase 8.1: package.json structure', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    pkg = readPackageJson();
  });

  // ---- name ----
  it('should have name "dev-sentinel"', () => {
    expect(pkg.name).toBe('dev-sentinel');
  });

  // ---- bin ----
  it('should have bin.sentinel pointing to "./dist/cli.js"', () => {
    const bin = pkg.bin as Record<string, string> | undefined;
    expect(bin).toBeDefined();
    expect(bin!.sentinel).toBe('./dist/cli.js');
  });

  // ---- engines ----
  it('should have engines.node field', () => {
    const engines = pkg.engines as Record<string, string> | undefined;
    expect(engines).toBeDefined();
    expect(engines!.node).toBeDefined();
    expect(typeof engines!.node).toBe('string');
    expect(engines!.node.length).toBeGreaterThan(0);
  });

  // ---- files field ----
  describe('files field', () => {
    it('should have a "files" field defined', () => {
      expect(pkg.files).toBeDefined();
    });

    it('should have "files" field as an array', () => {
      expect(Array.isArray(pkg.files)).toBe(true);
    });

    it('should include "dist" in the files array', () => {
      const files = pkg.files as string[] | undefined;
      expect(files).toBeDefined();
      expect(files).toContain('dist');
    });

    it('should NOT include "src" in the files array', () => {
      const files = pkg.files as string[] | undefined;
      expect(files).toBeDefined();
      expect(files).not.toContain('src');
    });

    it('should NOT include "tests" in the files array', () => {
      const files = pkg.files as string[] | undefined;
      expect(files).toBeDefined();
      expect(files).not.toContain('tests');
    });

    it('should NOT include "test" in the files array', () => {
      // Covers both "test" and "tests" naming conventions
      const files = pkg.files as string[] | undefined;
      expect(files).toBeDefined();
      expect(files).not.toContain('test');
    });
  });

  // ---- prepublishOnly script ----
  describe('prepublishOnly script', () => {
    it('should have a "prepublishOnly" script defined', () => {
      const scripts = pkg.scripts as Record<string, string> | undefined;
      expect(scripts).toBeDefined();
      expect(scripts!.prepublishOnly).toBeDefined();
    });

    it('should set prepublishOnly to "npm run build && npm test"', () => {
      const scripts = pkg.scripts as Record<string, string> | undefined;
      expect(scripts).toBeDefined();
      expect(scripts!.prepublishOnly).toBe('npm run build && npm test');
    });

    it('should run build before test in prepublishOnly (build comes first)', () => {
      const scripts = pkg.scripts as Record<string, string> | undefined;
      expect(scripts).toBeDefined();
      const prepublish = scripts!.prepublishOnly ?? '';
      const buildIndex = prepublish.indexOf('build');
      const testIndex = prepublish.indexOf('test');
      expect(buildIndex).toBeGreaterThanOrEqual(0);
      expect(testIndex).toBeGreaterThan(buildIndex);
    });
  });
});

// =============================================================================
// 2. Shebang line tests (source file)
// =============================================================================
describe('Phase 8.1: shebang line in src/cli.ts', () => {
  it('should have src/cli.ts file present', () => {
    expect(fs.existsSync(SRC_CLI_PATH)).toBe(true);
  });

  it('should have "#!/usr/bin/env node" as the first line of src/cli.ts', () => {
    const firstLine = readFirstLine(SRC_CLI_PATH);
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('should have the shebang line followed by actual code (not empty)', () => {
    const content = fs.readFileSync(SRC_CLI_PATH, 'utf-8');
    const lines = content.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('#!/usr/bin/env node');
    // The line after the shebang should not be another shebang
    expect(lines[1]).not.toMatch(/^#!/);
  });
});

// =============================================================================
// 3. Build output tests (compiled dist/cli.js)
// =============================================================================
describe('Phase 8.1: build output (dist/cli.js)', () => {
  // NOTE: These tests require `npm run build` to have been run.
  // In CI, the build step should precede this test suite.
  // If dist/cli.js does not exist, we skip gracefully but still fail.

  it('should have dist/cli.js file present after build', () => {
    expect(fs.existsSync(DIST_CLI_PATH)).toBe(true);
  });

  it('should have "#!/usr/bin/env node" as the first line of dist/cli.js', () => {
    if (!fs.existsSync(DIST_CLI_PATH)) {
      // If file doesn't exist, fail explicitly
      expect(fs.existsSync(DIST_CLI_PATH)).toBe(true);
      return;
    }
    const firstLine = readFirstLine(DIST_CLI_PATH);
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('should have dist/cli.js be a valid JavaScript file (contains "use strict" or exports)', () => {
    if (!fs.existsSync(DIST_CLI_PATH)) {
      expect(fs.existsSync(DIST_CLI_PATH)).toBe(true);
      return;
    }
    const content = fs.readFileSync(DIST_CLI_PATH, 'utf-8');
    // After a real TypeScript compilation, the file should contain actual code
    const hasUseStrict = content.includes('"use strict"');
    const hasExports = content.includes('exports.');
    const hasRequire = content.includes('require(');
    expect(hasUseStrict || hasExports || hasRequire).toBe(true);
  });
});

// =============================================================================
// 4. npm pack verification tests
// =============================================================================
describe('Phase 8.1: npm pack output verification', () => {
  let packOutput: Array<{ path: string; size: number; mode: number }>;
  let packRaw: string;

  beforeAll(() => {
    try {
      // Run npm pack --dry-run --json to get the list of files that would be included
      // The --dry-run flag prevents creating an actual tarball
      // The --json flag outputs structured JSON
      packRaw = execSync('npm pack --dry-run --json 2>/dev/null', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 30000,
      });

      // npm pack --json returns an array with one element containing a "files" array
      const parsed = JSON.parse(packRaw);
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0].files)) {
        packOutput = parsed[0].files as Array<{ path: string; size: number; mode: number }>;
      } else {
        packOutput = [];
      }
    } catch {
      // If npm pack fails, we still want the tests to run (and fail meaningfully)
      packOutput = [];
      packRaw = '';
    }
  });

  it('should produce a non-empty file list from npm pack --dry-run', () => {
    expect(packOutput.length).toBeGreaterThan(0);
  });

  it('should include package.json in the pack output', () => {
    const paths = packOutput.map((f) => f.path);
    expect(paths).toContain('package.json');
  });

  it('should include files from dist/ in the pack output', () => {
    const distFiles = packOutput.filter((f) => f.path.startsWith('dist/'));
    expect(distFiles.length).toBeGreaterThan(0);
  });

  it('should NOT include any files from src/ in the pack output', () => {
    const srcFiles = packOutput.filter((f) => f.path.startsWith('src/'));
    expect(srcFiles).toHaveLength(0);
  });

  it('should NOT include any files from tests/ in the pack output', () => {
    const testFiles = packOutput.filter((f) => f.path.startsWith('tests/'));
    expect(testFiles).toHaveLength(0);
  });

  it('should NOT include tsconfig.json in the pack output', () => {
    const paths = packOutput.map((f) => f.path);
    expect(paths).not.toContain('tsconfig.json');
  });

  it('should NOT include jest.config.js in the pack output', () => {
    const paths = packOutput.map((f) => f.path);
    expect(paths).not.toContain('jest.config.js');
  });

  it('should NOT include any .ts source files in the pack output', () => {
    const tsFiles = packOutput.filter(
      (f) => f.path.endsWith('.ts') && !f.path.endsWith('.d.ts'),
    );
    expect(tsFiles).toHaveLength(0);
  });

  it('should NOT include node_modules in the pack output', () => {
    // npm pack should never include node_modules (npm handles this),
    // but we verify just in case
    const nodeModulesFiles = packOutput.filter((f) => f.path.startsWith('node_modules/'));
    expect(nodeModulesFiles).toHaveLength(0);
  });
});
