import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';

export interface AgentProcessLaunch { executable: string; args: string[] }

const claudeConnectionVariables = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL',
  'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const;

export function resolveAgentProcessEnvironment(provider: 'codex' | 'claude', inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...inherited };
  if (provider !== 'claude') return environment;
  try {
    const directory = inherited.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { env?: Record<string, unknown> };
    for (const name of claudeConnectionVariables) {
      const value = settings.env?.[name];
      if (!environment[name] && typeof value === 'string' && value) environment[name] = value;
    }
  } catch { /* The CLI reports missing or malformed local authentication itself. */ }
  return environment;
}

function windowsCommandPath(command: string): string | undefined {
  const hasPath = isAbsolute(command) || command.includes('/') || command.includes('\\');
  const extensions = extname(command) ? [''] : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const directories = hasPath ? [''] : (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    const base = directory.replace(/^"(.*)"$/, '$1');
    for (const extension of extensions) {
      const name = `${command}${extension}`;
      const candidate = hasPath ? resolve(name) : join(base, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function windowsShimLaunch(path: string, args: string[]): AgentProcessLaunch {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const powershell = extname(path).toLowerCase() === '.ps1';
  const invocation = lines.filter(line => powershell ? line.includes('$args') && line.includes('$basedir') : line.includes('%*')).at(-1) ?? '';
  const references = powershell
    ? [...invocation.matchAll(/["']?\$basedir[\\/]([^"'\r\n]+\.(?:exe|mjs|cjs|js))["']?/gi)]
    : [...invocation.matchAll(/"%(?:dp0%|~dp0)[\\/]([^"\r\n]+\.(?:exe|mjs|cjs|js))"/gi)];
  const target = references.map(match => resolve(dirname(path), match[1])).reverse().find(existsSync);
  if (!target) throw new Error(`Die Windows-Befehlsdatei ${path} verweist nicht auf ein direkt startbares Programm. Hinterlege die zugehörige .exe- oder .js-Datei als CLI-Programmpfad.`);
  return ['.js', '.cjs', '.mjs'].includes(extname(target).toLowerCase())
    ? { executable: process.execPath, args: [target, ...args] }
    : { executable: target, args };
}

export function resolveAgentProcessLaunch(executable: string, args: string[]): AgentProcessLaunch {
  if (process.platform !== 'win32') return { executable, args };
  const resolved = windowsCommandPath(executable) ?? executable;
  const extension = extname(resolved).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(extension)) return { executable: process.execPath, args: [resolved, ...args] };
  if (['.cmd', '.bat', '.ps1'].includes(extension)) return windowsShimLaunch(resolved, args);
  return { executable: resolved, args };
}
