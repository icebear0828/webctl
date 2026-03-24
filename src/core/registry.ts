/**
 * Command registry — adapters register via cli().
 */

import type { Transport } from './transport.js';
import type { SessionStore } from './session.js';

export enum Strategy {
  PUBLIC = 'public',
  COOKIE = 'cookie',
  HEADER = 'header',
  BROWSER = 'browser',
}

export interface Arg {
  name: string;
  type?: 'string' | 'int' | 'float' | 'boolean';
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  help?: string;
  choices?: string[];
}

export type CommandArgs = Record<string, unknown>;

export type CommandFunc = (
  transport: Transport,
  session: SessionStore<unknown>,
  kwargs: CommandArgs,
) => Promise<unknown>;

export interface CliCommand {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy: Strategy;
  args: Arg[];
  columns?: string[];
  func?: CommandFunc;
}

export interface CliOptions extends Partial<Omit<CliCommand, 'site' | 'name'>> {
  site: string;
  name: string;
}

const registry = new Map<string, CliCommand>();

export function cli(opts: CliOptions): CliCommand {
  const cmd: CliCommand = {
    site: opts.site,
    name: opts.name,
    description: opts.description ?? '',
    domain: opts.domain,
    strategy: opts.strategy ?? Strategy.PUBLIC,
    args: opts.args ?? [],
    columns: opts.columns,
    func: opts.func,
  };

  registry.set(`${cmd.site}/${cmd.name}`, cmd);
  return cmd;
}

export function getRegistry(): Map<string, CliCommand> {
  return registry;
}

export function getCommand(site: string, name: string): CliCommand | undefined {
  return registry.get(`${site}/${name}`);
}

export function getSiteCommands(site: string): CliCommand[] {
  return [...registry.values()].filter(c => c.site === site);
}

export function getSites(): string[] {
  return [...new Set([...registry.values()].map(c => c.site))].sort();
}
