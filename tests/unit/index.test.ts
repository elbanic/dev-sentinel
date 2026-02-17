import { VERSION } from '../../src/index';

describe('dev-sentinel', () => {
  it('should export version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
