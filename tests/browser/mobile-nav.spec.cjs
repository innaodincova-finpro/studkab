const {test,expect}=require('@playwright/test');
for(const browserName of ['chromium','webkit']){
 test.describe(browserName+' mobile navigation',()=>{
  test('menu stays below scrolling content after input, resize and restored height',async({playwright})=>{
   const browser=await playwright[browserName].launch();
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const page=await context.newPage();
   try {
   await page.goto('http://127.0.0.1:4173/index.html');
   await page.evaluate(()=>{tab='more';render();document.querySelectorAll('#page details').forEach(d=>d.open=true);});
   const check=async()=>{
    const box=await page.evaluate(()=>{const n=document.getElementById('tabbar').getBoundingClientRect(),p=document.getElementById('page').getBoundingClientRect();return {bottom:n.bottom,top:n.top,contentBottom:p.bottom,height:innerHeight,documentHeight:document.documentElement.scrollHeight};});
    expect(Math.abs(box.bottom-box.height)).toBeLessThanOrEqual(2);
    expect(box.contentBottom).toBeLessThanOrEqual(box.top+1);
    expect(box.documentHeight).toBeLessThanOrEqual(box.height+2);
   };
   await check();
   await page.locator('#page input').first().focus();
   await page.setViewportSize({width:390,height:480});await check();
   await page.locator('#page input').first().blur();
   await page.setViewportSize({width:390,height:844});
   await page.evaluate(()=>{const p=document.getElementById('page');p.scrollTop=p.scrollHeight;});
   await check();
   await expect(page.locator('#page summary').last()).toBeInViewport();
   await page.locator('#tabbar button').first().click();
   expect(await page.locator('#page').evaluate(p=>p.scrollTop)).toBe(0);
   await check();
   } finally {await browser.close();}
  });
 });
}
