const {defineConfig}=require('@playwright/test');
const path=require('node:path'),root=path.resolve(__dirname,'..');
module.exports=defineConfig({testDir:'./live',timeout:180000,workers:1,retries:0,outputDir:path.join(root,'test-results/live'),use:{browserName:'chromium',headless:true,viewport:{width:1280,height:900},screenshot:'only-on-failure',trace:'off',video:'off'},webServer:{cwd:root,command:'npx vite --config tests/live.vite.config.mjs --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174/index.html',reuseExistingServer:false}});
