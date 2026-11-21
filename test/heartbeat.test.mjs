import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requiresFreshnessSignal,signalMonitor} from '../src/heartbeat.mjs';

test('only scheduled production jobs activate the freshness monitor',()=>{
 assert.equal(requiresFreshnessSignal('production','schedule'),true);
 assert.equal(requiresFreshnessSignal('production','workflow_dispatch'),false);
 assert.equal(requiresFreshnessSignal('synthetic','workflow_dispatch'),false);
});

test('monitor sends start, success and failure without data or redirects',async()=>{
 const urls=[];
 const mock=async(url,options)=>{urls.push({url:String(url),method:options.method,redirect:options.redirect});return new Response('OK',{status:200});};
 const endpoint='https://hc-ping.com/12345678-1234-1234-1234-123456789abc';
 for(const event of ['start','success','fail'])await signalMonitor(endpoint,event,mock);
 assert.deepEqual(urls.map(x=>x.url),[endpoint+'/start',endpoint,endpoint+'/fail']);
 assert.ok(urls.every(x=>x.method==='POST'&&x.redirect==='manual'));
 await assert.rejects(()=>signalMonitor('https://example.com/12345678-1234-1234-1234-123456789abc','success',mock),/invalid/);
 await assert.rejects(()=>signalMonitor('https://hc-ping.com/12345678-1234-1234-1234-123456789abc?token=oops','success',mock),/invalid/);
 await assert.rejects(()=>signalMonitor(endpoint,'success',async()=>new Response('not found',{status:200})),/not accepted/);
 await assert.rejects(()=>signalMonitor(endpoint,'success',async()=>new Response('rate limited',{status:200})),/not accepted/);
});
