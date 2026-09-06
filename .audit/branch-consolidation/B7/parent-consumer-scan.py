from pathlib import Path
import json, re, subprocess

base = Path('.audit/branch-consolidation/B7')
tracked = list(filter(None, subprocess.check_output(['git', 'ls-files', '-z'], text=True).split('\0')))
roots = ('src/', 'convex/', 'shared/', 'scripts/', 'tests/', '.github/')
paths = [p for p in tracked if p.startswith(roots) or '/' not in p or p == '.factory/factory.toml']
excluded = []
scanned = []
mentions = []
imports = []
names = r'(?:docx|svelte-exmarkdown|tippy\.js|eslint|@types/bun|bun:test)'
package_import = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire(?:\.resolve)?\s*\(\s*)["'](''' + names + r'''(?:/[^"']*)?)["']''', re.MULTILINE)
broad = re.compile(r'(?<![\w-])' + names + r'(?![\w-])')
for name in paths:
    p = Path(name)
    if not p.is_file() or p.suffix in ('.lock', '.md', '.png', '.woff2', '.ico') or name == 'package-lock.json':
        excluded.append(name)
        continue
    raw = p.read_bytes()
    if b'\0' in raw:
        excluded.append(name)
        continue
    source = raw.decode('utf-8', errors='replace')
    scanned.append(name)
    for match in package_import.finditer(source):
        imports.append({'path': name, 'line': source.count('\n', 0, match.start()) + 1, 'match': match.group(0)})
    for n, line in enumerate(source.splitlines(), 1):
        if broad.search(line):
            mentions.append({'path': name, 'line': n, 'text': line})
obsolete = [p for p in tracked if p.startswith('test/')]
expected = (base / 'before-tsconfig.json').read_text()
for ext in ['js', 'ts', 'svelte']:
    old = '\t\t"test/**/*.' + ext + '",\n'
    assert expected.count(old) == 1
    expected = expected.replace(old, '')
assert expected == Path('tsconfig.json').read_text()
report = {'tracked_inventory_argv': ['git', 'ls-files', '-z'], 'selected_roots': roots,
          'selected_root_files_and_factory_config': True, 'scanned': scanned, 'excluded': excluded,
          'literal_import_pattern': package_import.pattern, 'broad_mention_pattern': broad.pattern,
          'literal_imports': imports, 'all_package_mentions': mentions,
          'tracked_test_directory_files': obsolete, 'test_directory_exists': Path('test').exists(),
          'tsconfig_exact_three_line_removal': True,
          'limit': 'Literal import scan plus broad name inventory; computed package names cannot be proven absent by regex. Full canonical build/tests provide separate runtime coverage.'}
(base / 'parent-consumer-scan.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'scanned': len(scanned), 'mentions': len(mentions), 'literal_imports': imports,
                  'obsolete_files': obsolete, 'test_directory_exists': Path('test').exists()}))
assert not imports and not obsolete and not Path('test').exists()
