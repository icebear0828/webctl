#!/usr/bin/env node

/**
 * CLI entry point — discovers sites and wires up Commander.
 */

import { Command } from 'commander';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRegistry,
  getSites,
  getSiteCommands,
  type CliCommand,
  type Format,
  HttpTransport,
  createSessionStore,
  formatOutput,
  success,
  error,
  EXIT,
} from './core/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSites(): Promise<void> {
  const sitesDir = join(__dirname, 'sites');
  let entries: string[];
  try {
    entries = readdirSync(sitesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return;
  }

  for (const site of entries) {
    try {
      await import(`./sites/${site}/index.js`);
    } catch {
      // skip sites that fail to load
    }
  }
}

function wireCommand(program: Command, cmd: CliCommand, globalOpts: () => { format: Format; verbose: boolean }): void {
  let siteCmd = program.commands.find(c => c.name() === cmd.site);
  if (!siteCmd) {
    siteCmd = new Command(cmd.site)
      .description(`${cmd.site} commands`)
      .enablePositionalOptions()
      .passThroughOptions();
    program.addCommand(siteCmd);
  }

  const sub = siteCmd
    .command(cmd.name)
    .description(cmd.description);

  for (const arg of cmd.args) {
    if (arg.positional) {
      const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
      sub.argument(bracket, arg.help ?? '');
    } else {
      const flag = arg.type === 'boolean'
        ? `--${arg.name}`
        : `--${arg.name} <value>`;
      sub.option(flag, arg.help ?? '', arg.default as string | undefined);
    }
  }

  sub.action(async (...actionArgs: unknown[]) => {
    const opts = globalOpts();
    const kwargs: Record<string, unknown> = {};

    // collect positional args
    const positionals = cmd.args.filter(a => a.positional);
    for (let i = 0; i < positionals.length; i++) {
      const arg = positionals[i]!;
      kwargs[arg.name] = actionArgs[i];
    }

    // collect options (last before Command is the opts object)
    const cmdOpts = actionArgs[actionArgs.length - 2] as Record<string, unknown> | undefined;
    if (cmdOpts && typeof cmdOpts === 'object') {
      for (const arg of cmd.args.filter(a => !a.positional)) {
        if (arg.name in cmdOpts) {
          let val = cmdOpts[arg.name];
          if (arg.type === 'int') val = parseInt(val as string, 10);
          if (arg.type === 'float') val = parseFloat(val as string);
          kwargs[arg.name] = val;
        }
      }
    }

    if (!cmd.func) {
      console.error(`Command ${cmd.site}/${cmd.name} has no implementation`);
      process.exit(EXIT.GENERAL_ERROR);
    }

    const transport = new HttpTransport();
    const session = createSessionStore({ site: cmd.site, ttlMs: 0 });

    try {
      const data = await cmd.func(transport, session, kwargs);
      const output = formatOutput(success(data), opts.format);
      console.log(output);
      process.exit(EXIT.SUCCESS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const output = formatOutput(error('COMMAND_ERROR', msg), opts.format);
      console.error(output);
      process.exit(EXIT.GENERAL_ERROR);
    } finally {
      await transport.dispose();
    }
  });
}

async function main(): Promise<void> {
  await loadSites();

  const program = new Command()
    .name('webctl')
    .description('Make any website your CLI. HTTP-first, browser fallback.')
    .version('0.1.0')
    .option('-f, --format <fmt>', 'Output format: json or text', 'json')
    .option('--verbose', 'Enable debug logging to stderr', false)
    .enablePositionalOptions();

  const globalOpts = () => program.opts<{ format: Format; verbose: boolean }>();

  // list command (register before sites to avoid name collision)
  program
    .command('commands')
    .description('List all available commands')
    .action(() => {
      const opts = globalOpts();
      const sites = getSites();
      const data = sites.flatMap(site =>
        getSiteCommands(site).map(c => ({
          command: `${c.site} ${c.name}`,
          strategy: c.strategy,
          description: c.description,
        })),
      );
      console.log(formatOutput(success(data), opts.format));
    });

  // wire all registered site commands
  for (const cmd of getRegistry().values()) {
    wireCommand(program, cmd, globalOpts);
  }

  await program.parseAsync();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
