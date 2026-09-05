import { chromium } from 'playwright-core';
const results = [];
for (const variant of [
  {name:'default-shell',options:{}},
  {name:'full-chromium',options:{channel:'chromium'}},
  {name:'shell-blink-fine',options:{args:['--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2']}},
]) {
  let browser;
  try {
    browser = await chromium.launch({headless:true,timeout:30_000,...variant.options});
    for (const hasTouch of [false,true]) {
      const context=await browser.newContext({hasTouch});
      try {
        const page=await context.newPage();
        await page.setContent('<iframe srcdoc="<style>div{height:28px}@media(pointer:coarse){div{height:44px}}</style><div id=row></div>"></iframe>');
        const cdp=await context.newCDPSession(page);
        const read=async (stage)=>{
          const frames=[];
          for (const f of page.frames()) frames.push(await f.evaluate(()=>({coarse:matchMedia('(pointer: coarse)').matches,fine:matchMedia('(pointer: fine)').matches,none:matchMedia('(pointer: none)').matches,hover:matchMedia('(hover: hover)').matches,maxTouchPoints:navigator.maxTouchPoints,rowHeight:document.querySelector('#row')?.getBoundingClientRect().height??null})));
          const record={variant:variant.name,browserVersion:browser.version(),hasTouch,stage,frames};results.push(record);console.log(JSON.stringify(record));
        };
        await read('fresh-context');
        for (const enabled of [true,false]) {
          await cdp.send('Emulation.setTouchEmulationEnabled',{enabled});
          await read('touch-'+enabled+'-immediate');
          await page.waitForTimeout(250);
          await read('touch-'+enabled+'-after-250ms');
        }
      } finally {await context.close();}
    }
  } catch(error) {console.log(JSON.stringify({variant:variant.name,error:String(error)}));process.exitCode=1;}
  finally {await browser?.close();}
}
console.log(JSON.stringify({completed:true,records:results.length,platform:process.platform,arch:process.arch}));
