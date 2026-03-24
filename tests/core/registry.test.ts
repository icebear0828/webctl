import { describe, it, expect } from 'vitest';
import { cli, Strategy, getCommand, getSites, getSiteCommands } from '../../src/core/registry.js';

describe('Registry', () => {
  it('registers and retrieves a command', () => {
    cli({
      site: 'testsite',
      name: 'testcmd',
      description: 'Test command',
      strategy: Strategy.PUBLIC,
      args: [{ name: 'query', positional: true, required: true }],
    });

    const cmd = getCommand('testsite', 'testcmd');
    expect(cmd).toBeDefined();
    expect(cmd?.site).toBe('testsite');
    expect(cmd?.name).toBe('testcmd');
    expect(cmd?.strategy).toBe(Strategy.PUBLIC);
  });

  it('lists sites', () => {
    const sites = getSites();
    expect(sites).toContain('testsite');
  });

  it('lists commands for a site', () => {
    const cmds = getSiteCommands('testsite');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[0]?.name).toBe('testcmd');
  });
});
