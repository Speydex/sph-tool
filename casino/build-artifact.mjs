#!/usr/bin/env node
/**
 * Erzeugt aus der eigenständigen Spieldatei das Fragment für Claude Artifacts.
 * Artifacts liefern <!doctype>, <html>, <head> und <body> selbst; die Datei darf
 * diese Tags deshalb nicht mitbringen. Quelle bleibt nile-royale.html.
 *
 *   node build-artifact.mjs [ziel.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'nile-royale.html'), 'utf8');
const target = resolve(process.argv[2] || resolve(here, 'nile-royale.artifact.html'));

function section(name) {
  const open = `<!-- ARTIFACT:${name}:BEGIN -->`;
  const close = `<!-- ARTIFACT:${name}:END -->`;
  const a = source.indexOf(open);
  const b = source.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error(`Marker ${name} fehlt in nile-royale.html`);
  return source.slice(a + open.length, b).trim();
}

const fragment = section('HEAD') + '\n\n' + section('BODY') + '\n';

/* Ganze Tags prüfen, nicht Präfixe — <header> ist erlaubt, <head> nicht. */
for (const tag of ['!doctype', 'html', 'head', 'body']) {
  if (new RegExp(`<\\/?${tag}[\\s>]`, 'i').test(fragment)) throw new Error(`Fragment enthält ein <${tag}>-Tag`);
}

writeFileSync(target, fragment);
console.log(`${target} · ${(fragment.length / 1024).toFixed(1)} KB · ${fragment.split('\n').length} Zeilen`);
