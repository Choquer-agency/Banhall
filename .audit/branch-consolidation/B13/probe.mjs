import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const req=createRequire(path.join(process.cwd(),'package.json'));
const ts=req('typescript');
const {getSchema}=req('@tiptap/core');
const paths=['src/lib/components/editor/docSearch.ts','src/lib/components/editor/Editor.svelte','src/lib/tiptapConfig.ts'];
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=Object.fromEntries(paths.map(p=>[p,hash(p)]));
function compile(source){const ex={};new Function('exports','require',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(ex,req);return ex;}
const current=compile(fs.readFileSync(paths[0],'utf8'));
const config=compile(fs.readFileSync(paths[2],'utf8'));
const baseline='cc6b706c3b43f971d944cb703a4174eabf3134d9';
const oldSource=execFileSync('git',['show',baseline+':'+paths[1]],{encoding:'utf8'});
const block=oldSource.match(/<script module lang="ts">([\s\S]*?)<\/script>/)[1];
const ast=ts.createSourceFile('old.ts',block,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const printer=ts.createPrinter();
const names=['normalizeForMatch','buildSearchIndex','findAllOccurrencesCI'];
const funcs=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>'export '+printer.printNode(ts.EmitHint.Unspecified,s,ast)).join('\n');
const old=compile(funcs);
const results=[];
for(const editable of [true,false]){
 const schema=getSchema(config.getEditorExtensions({editable}));
 const inlineNodes=Object.values(schema.nodes).filter(n=>n.isInline).map(n=>({name:n.name,isAtom:n.isAtom,isLeaf:n.isLeaf}));
 const fixtures=[
  {name:'Unicode prefix shifts following match',content:[schema.text('İ target tail')],needle:'target',expected:[{from:3,to:9,text:'target'}]},
  {name:'Unicode prefix loses trailing match',content:[schema.text('İ target')],needle:'target',expected:[{from:3,to:9,text:'target'}]},
  {name:'Hard break must not concatenate words',content:[schema.text('alpha'),schema.node('hardBreak'),schema.text('beta')],needle:'alphabeta',expected:[]},
  {name:'Hard break separator whitespace search',content:[schema.text('alpha'),schema.node('hardBreak'),schema.text('beta')],needle:'alpha beta',expected:[{from:1,to:11,text:'alpha beta'}]},
  {name:'Ordinary match control',content:[schema.text('A target tail')],needle:'target',expected:[{from:3,to:9,text:'target'}]},
 ];
 for(const f of fixtures){const doc=schema.node('doc',null,[schema.node('paragraph',null,f.content)]);doc.check();const actual=current.findAllOccurrencesCI(doc,f.needle);const prior=old.findAllOccurrencesCI(doc,f.needle);results.push({editable,fixture:f.name,inlineNodes,document:doc.toJSON(),renderEquivalentText:doc.textBetween(0,doc.content.size,'\n','\n'),needle:f.needle,index:current.buildSearchIndex(doc),actual,expected:f.expected,prior,unchangedFromBaseline:JSON.stringify(actual)===JSON.stringify(prior),matchesExpectation:JSON.stringify(actual)===JSON.stringify(f.expected)});}
}
const after=Object.fromEntries(paths.map(p=>[p,hash(p)]));assert.deepEqual(before,after);
console.log(JSON.stringify({baseline,node:process.version,sourceHashesBefore:before,sourceHashesAfter:after,oldEditorSha256:createHash('sha256').update(oldSource).digest('hex'),method:'Actual installed getEditorExtensions/getSchema; valid persisted-schema PM nodes; current and AST-extracted pre-B2 helper functions. No DOM or browser.',results},null,2));
