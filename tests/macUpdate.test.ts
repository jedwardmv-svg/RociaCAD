import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundlePathFromExe, buildSwapScript, cannotReplaceReason, pickMacZip } from '../src/main/macUpdateCore';

const files = [
  { url: 'RociaCAD-0.5.0-Mac-arm64.zip', sha512: 'a' },
  { url: 'RociaCAD-0.5.0-Mac-x64.zip', sha512: 'b' },
  { url: 'RociaCAD-0.5.0-Mac-arm64.dmg', sha512: 'c' },
  { url: 'RociaCAD-0.5.0-Mac-x64.dmg', sha512: 'd' },
];

describe('Actualización en Mac', () => {
  it('elige el zip de la arquitectura del equipo', () => {
    expect(pickMacZip(files, 'arm64')?.sha512).toBe('a');
    expect(pickMacZip(files, 'x64')?.sha512).toBe('b');
    expect(pickMacZip(files.filter((f) => f.url.endsWith('.dmg')), 'arm64')).toBeUndefined();
  });

  it('encuentra el paquete .app y detecta dónde no se puede reemplazar', () => {
    expect(bundlePathFromExe('/Applications/RociaCAD.app/Contents/MacOS/RociaCAD')).toBe('/Applications/RociaCAD.app');
    expect(bundlePathFromExe('/usr/bin/node')).toBeNull();
    expect(cannotReplaceReason('/Applications/RociaCAD.app')).toBeNull();
    expect(cannotReplaceReason('/private/var/folders/x/AppTranslocation/ABC/d/RociaCAD.app')).toMatch(/Aplicaciones/);
    expect(cannotReplaceReason('/Volumes/RociaCAD 0.5.0/RociaCAD.app')).toMatch(/disco de instalación/);
  });

  // El guion se prueba de verdad con bash, cambiando las herramientas de macOS por equivalentes
  function setup(dittoFails = false) {
    const root = mkdtempSync(join(tmpdir(), 'rocia-mac-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const tool = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
      return join(bin, name);
    };
    const tools = {
      ditto: tool('ditto', dittoFails ? 'exit 1' : 'cp -R "$1" "$2"'),
      xattr: tool('xattr', 'exit 0'),
      open: tool('open', `echo "$1" > '${join(root, 'abierto.txt')}'`),
    };
    const apps = join(root, 'Aplicaciones');
    const current = join(apps, 'RociaCAD.app');
    mkdirSync(join(current, 'Contents'), { recursive: true });
    writeFileSync(join(current, 'Contents', 'version'), '0.4.0');
    const stagedDir = join(root, 'tmp', 'app');
    const staged = join(stagedDir, 'RociaCAD.app');
    mkdirSync(join(staged, 'Contents'), { recursive: true });
    writeFileSync(join(staged, 'Contents', 'version'), '0.5.0');
    const done = spawnSync('true'); // un proceso que ya terminó
    const script = join(root, 'instalar.sh');
    writeFileSync(script, buildSwapScript({ pid: done.pid ?? 999999, current, staged, relaunch: true, log: join(root, 'log.txt'), failMarker: join(root, 'fallo.txt'), tools }));
    return { root, apps, current, staged, script };
  }

  // el guion es de bash (macOS); en Windows no se puede ejecutar
  const bashIt = it.skipIf(process.platform === 'win32');

  bashIt('reemplaza la app por la nueva y la vuelve a abrir', () => {
    const t = setup();
    execFileSync('/bin/bash', [t.script]);
    expect(readFileSync(join(t.current, 'Contents', 'version'), 'utf8')).toBe('0.5.0');
    expect(existsSync(`${t.current}.anterior`)).toBe(false);
    expect(existsSync(`${t.current}.nueva`)).toBe(false);
    expect(existsSync(t.staged)).toBe(false);
    expect(readFileSync(join(t.root, 'abierto.txt'), 'utf8').trim()).toBe(t.current);
    expect(existsSync(join(t.root, 'fallo.txt'))).toBe(false);
  });

  bashIt('si la copia falla deja intacta la versión anterior', () => {
    const t = setup(true);
    spawnSync('/bin/bash', [t.script]);
    expect(readFileSync(join(t.current, 'Contents', 'version'), 'utf8')).toBe('0.4.0');
    // se anota el fallo y se vuelve a abrir la versión que ya estaba
    expect(readFileSync(join(t.root, 'fallo.txt'), 'utf8')).toMatch(/No se pudo copiar/);
    expect(readFileSync(join(t.root, 'abierto.txt'), 'utf8').trim()).toBe(t.current);
    expect(existsSync(`${t.current}.nueva`)).toBe(false);
  });
});
