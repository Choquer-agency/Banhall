import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const [source, phase] = process.argv.slice(2);
const { resolveWorkspaceRouteState, shouldQueryWorkspaceAccess } = await import(pathToFileURL(resolve(source)));
const rows = [
  ['current', ['current', 'current', 'current', 'current'], false],
  ['preview', ['loading', 'current', 'current', 'preview'], true],
  [null, ['loading', 'current', 'current', 'preview'], true],
  ['', ['loading', 'current', 'current', 'preview'], true],
  ['banana', ['loading', 'current', 'current', 'preview'], true],
];
const accesses = [{status:'loading'}, {status:'error'}, {status:'ready',available:false}, {status:'ready',available:true}];
for (const [workspaceParam, expected, shouldQuery] of rows) {
  accesses.forEach((access, i) => {
    const args = {workspaceParam, access, ...(phase === 'before' ? {localDevelopment:false} : {})};
    const actual = resolveWorkspaceRouteState(args);
    assert.equal(actual, expected[i]);
    console.log([JSON.stringify(workspaceParam), JSON.stringify(access), actual].join('\t'));
  });
  const actual = shouldQueryWorkspaceAccess(workspaceParam);
  assert.equal(actual, shouldQuery);
  console.log([JSON.stringify(workspaceParam), 'shouldQuery', actual].join('\t'));
}
