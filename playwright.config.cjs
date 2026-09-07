const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests/browser',timeout:90000,retries:0,use:{browserName:'chromium',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173/tests/qa.html',reuseExistingServer:false}});
