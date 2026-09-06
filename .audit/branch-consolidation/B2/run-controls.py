from pathlib import Path
import tempfile, subprocess, json, hashlib
root = Path.cwd()
out = root / '.audit/branch-consolidation/B2'
source = (root / 'src/lib/components/editor/docSearch.ts').read_text()
tests = (root / 'src/lib/components/editor/docSearch.test.ts').read_text()
controls = {
 'per-needle': source.replace('export function findOccurrencesBatch(doc: PMNode, finds: string[]): Range[][] {', '''export function findOccurrencesBatch(doc: PMNode, finds: string[]): Range[][] {
  return finds.map((find) => evaluateBatch(doc, [find])[0]);
}
function evaluateBatch(doc: PMNode, finds: string[]): Range[][] {'''),
 'no-empty-guard': source.replace('doc.content.size < 2 || normalized.every((n) => !n)', 'doc.content.size < 2'),
}
for name, mutated in controls.items():
 assert mutated != source
 (out / (name + '.ts.snapshot')).write_text(mutated)
 with tempfile.TemporaryDirectory(prefix='b2-control-') as directory:
  temp = Path(directory)
  (temp / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
  (temp / 'docSearch.ts').write_text(mutated)
  (temp / 'docSearch.test.ts').write_text(tests)
  config = temp / 'vitest.config.mjs'
  config.write_text('export default { test: { include: ["docSearch.test.ts"] } };\n')
  cmd = ['node', str(root / 'node_modules/vitest/vitest.mjs'), 'run', '--root', str(temp), '--config', str(config), '--expect.requireAssertions']
  with (out / (name + '.log')).open('w') as f:
   result = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
  (out / (name + '.json')).write_text(json.dumps({'command':cmd,'exit':result.returncode,'sourceSha256':hashlib.sha256(mutated.encode()).hexdigest()})+'\n')
  print(name, result.returncode)
  assert result.returncode == 1
assert (root / 'src/lib/components/editor/docSearch.ts').read_text() == source
