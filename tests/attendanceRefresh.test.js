import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as rules from '../rules.js';

function harness() {
  const subscriptions=[], requests=[];
  const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm,'')
    .replace('import.meta.env.VITE_CONVEX_URL',"'test'").split('\nawait loadBranding();')[0];
  class Client { onUpdate(query,args,callback) { const sub={args,callback,stopped:false};subscriptions.push(sub);return ()=>sub.stopped=true; } }
  const context=vm.createContext({...rules,console,URL,URLSearchParams,Intl,Date,
    ConvexClient:Client,ConvexHttpClient:Client,functions:{core:{adminAttendance:{},session:{}}},
    document:{getElementById(){return {};},addEventListener(){}},window:{addEventListener(){}},
    navigator:{},localStorage:{getItem(){return 'token';}},sessionStorage:{getItem(){return '';}},
    closeFrontCamera(){},setInterval(){},setTimeout(){},clearTimeout(){},
    request(path){return new Promise((resolve,reject)=>requests.push({path,resolve,reject}));}});
  vm.runInContext(source+`
    api=request; renderView=()=>{};
    globalThis.app={state,loadAdmin,watchData,stopWatch,resumeAttendance,
      refresh:fn=>refreshSession=fn};
    state.session={today:'2026-10-19',user:{role:'admin'},cutoff:{start:'2026-10-11',end:'2026-10-25'}};
    state.section='records';
  `,context);
  return {...context.app,subscriptions,requests};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const range=(start,end=start)=>({start,end});

test('a slow old date-range request cannot replace the current attendance or subscription',async()=>{
  const f=harness();
  const old=f.loadAdmin(range('2026-10-18'));f.requests[0].resolve({});await tick();
  const latest=f.loadAdmin(range('2026-10-19'));f.requests[2].resolve({});await tick();
  f.requests[3].resolve({punches:['current']});await latest;
  f.requests[1].resolve({punches:['old']});await old;
  assert.deepEqual(f.state.adminData.punches,['current']);
  assert.equal(f.subscriptions.length,1);
  assert.equal(f.subscriptions[0].args.from,'2026-10-19');
  assert.equal(f.state.adminLoading,false);
});

test('cancelled subscription callbacks cannot restore a previous approval list',async()=>{
  const f=harness();
  const first=f.loadAdmin(range('2026-10-18'));f.requests[0].resolve({});await tick();
  f.requests[1].resolve({punches:['old']});await first;
  const old=f.subscriptions[0];
  const second=f.loadAdmin(range('2026-10-19'));
  assert.equal(old.stopped,true);assert.equal(f.state.adminLoading,true);
  old.callback({punches:['late-old-event']});
  assert.deepEqual(f.state.adminData.punches,['old']);
  f.requests[2].resolve({});await tick();f.requests[3].resolve({punches:['current']});await second;
  old.callback({punches:['late-old-event']});assert.deepEqual(f.state.adminData.punches,['current']);
  f.subscriptions[1].callback({punches:['new-live-event']});assert.deepEqual(f.state.adminData.punches,['new-live-event']);
});

test('returning to the browser leaves an open approval and its reason intact',async()=>{
  const f=harness();f.refresh(async()=>{});
  const modal={kind:'interval-review',segment:2,reason:'Review in progress'};
  f.state.modal=modal;
  await f.resumeAttendance();
  assert.equal(f.state.modal,modal);assert.equal(f.requests.length,0);
});

test('a failed current load stays an error instead of showing old records as actionable',async()=>{
  const f=harness();f.state.adminData={punches:['old']};
  const loading=f.loadAdmin(range('2026-10-19'));
  f.requests[0].reject(new Error('Connection lost'));
  await assert.rejects(loading,/Connection lost/);
  assert.equal(f.state.adminLoading,false);assert.equal(f.state.adminLoadError,'Connection lost');
  assert.equal(f.subscriptions.length,0);
});
