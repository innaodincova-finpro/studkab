const {test,expect}=require('@playwright/test');
for(const width of [320,390,1440])test(`C075 registry actions and stages remain accessible at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});
 await page.goto('http://127.0.0.1:4173/reestr.html');
 await page.evaluate(()=>QA.switchUser('mobile-layout-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);
 await page.evaluate(()=>{D.items=Array.from({length:8},(_,i)=>({id:'mobile-'+i,requestNumber:i+1,student:'Учебный студент '+i,univ:'Учебный университет',topic:'Организация работы проектной команды',status:'new',format:{},passports:[],note:'Не менять'}));tab='list';openId=null;filter='all';query='';render();});
 const before=await page.evaluate(()=>JSON.stringify(D));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const buttons=page.locator('.registry-filters button');
 const keys=await buttons.evaluateAll(bs=>bs.map(b=>b.dataset.k));
 for(const key of keys){const button=page.locator(`.registry-filters [data-k="${key}"]`);const box=await button.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);await button.click();await expect(button).toHaveAttribute('aria-pressed','true');}
 await page.locator('.registry-filters [data-k="all"]').click();
 await expect(page.locator('.request-row')).toHaveCount(8);
 expect(await page.locator('#fab').evaluate(el=>getComputedStyle(el).position)).toBe('static');
  const action=await page.locator('#fab').boundingBox(),row=await page.locator('.request-row').first().boundingBox();expect(action.y+action.height).toBeLessThan(row.y);expect(row.height).toBeLessThan(240);
 if(width<960){
  await page.locator('.request-row').last().scrollIntoViewIfNeeded();
  expect(await page.locator('#fab').evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(0);
 }else{await expect(page.locator('.registry-table thead')).toBeVisible();expect(await page.locator('.tabs').evaluate(el=>el.getBoundingClientRect().width)).toBe(224);}
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
 await page.evaluate(()=>scrollTo(0,0));
 await expect(page.locator(".toast")).toHaveCSS("opacity","0");
 await page.screenshot({path:testInfo.outputPath(`c075-${width}.png`)});
 await page.locator('#fab').click();await expect(page.locator('.sheet')).toBeVisible();
 expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
});
