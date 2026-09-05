import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import ts from 'typescript';
import manifest from '../fixtures/legacy-manifest.json';
import contractChanges from '../fixtures/approved-contract-changes.json';

function exportsOf(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
    names = new Set<string>();
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        for (const e of node.exportClause.elements) names.add(e.name.text);
      else if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        for (const name of exportsOf(
          join(dirname(file), node.moduleSpecifier.text.replace(/\.js$/, '.ts')),
          seen,
        ))
          names.add(name);
    }
    if (!(ts.getModifiers(node as ts.HasModifiers) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
      names.add(node.name.text);
    if (ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
  }
  return names;
}
for (const entry of manifest.exports)
  test(`preserves public module exports: ${entry.file}`, () => {
    const names = exportsOf(join(process.cwd(), entry.file));
    for (const name of entry.names) expect(names.has(name), name).toBe(true);
  });
for (const entry of manifest.protectedFiles)
  test(`protected reference assertion or released migration: ${entry.file}`, () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(process.cwd(), entry.file)))
      .digest('hex');
    const change = (
      contractChanges as Record<string, { referenceSha256: string; sha256: string; reason: string }>
    )[entry.file];
    if (change) {
      expect(change.referenceSha256).toBe(entry.sha256);
      expect(change.reason.length).toBeGreaterThan(30);
    }
    expect(digest).toBe(change?.sha256 ?? entry.sha256);
  });
