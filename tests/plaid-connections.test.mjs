import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';
globalThis.plaidTest={};
registerHooks({resolve(specifier,context,nextResolve){
  const mocks={
    '@/lib/auth':'export async function requireFinanceApi(){return globalThis.plaidTest.denied}',
    '@/lib/config':'export function getPlaidConfig(){return {clientId:"test",secret:"test",environment:"sandbox",clientName:"Test"}}',
    '@/lib/crypto':'export function decrypt(v){return v}; export function encrypt(v){return v}',
    '@/lib/db':`export async function ensureSchema(){};
      export function getDb(){return {batch:async()=>{}}};
      export async function getStoredItems(){return globalThis.plaidTest.items};
      export async function queryRows(){return globalThis.plaidTest.existing};
      export async function saveItem(){globalThis.plaidTest.saved++};
      export async function markItemError(id,message){globalThis.plaidTest.errors.push({id,message})};
      export async function updateItemCursor(id){globalThis.plaidTest.updated.push(id)};`,
    'plaid':`export const CountryCode={Us:'US'},Products={Transactions:'transactions',Investments:'investments',Liabilities:'liabilities'},PlaidEnvironments={sandbox:'sandbox'};
      export class Configuration{};
      export class PlaidApi{
        async linkTokenCreate(request){globalThis.plaidTest.linkRequests.push(request);return {data:{link_token:'update-token'}}}
        async itemPublicTokenExchange(){globalThis.plaidTest.exchanged++;return {data:{item_id:'new',access_token:'new'}}}
        async accountsGet({access_token}){globalThis.plaidTest.attempted.push(access_token);if(access_token==='bad')throw {response:{data:{error_code:'NO_ACCOUNTS'}}};return {data:{accounts:[]}}}
        async transactionsSync(){return {data:{added:[],modified:[],removed:[],next_cursor:'done',has_more:false}}}
        async liabilitiesGet(){return {data:{liabilities:{credit:[]}}}}
        async investmentsHoldingsGet(){return {data:{accounts:[],securities:[],holdings:[]}}}
      }`,
  };
  if(mocks[specifier])return nextResolve(`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,context);
  if(specifier.startsWith('@/lib/'))return nextResolve(new URL(`../src/lib/${specifier.slice(6)}.ts`,import.meta.url).href,context);
  return nextResolve(specifier,context);
}});
const {syncAllItems,createUpdateLinkToken}=await import('../src/lib/plaid.ts');
const {POST:exchange}=await import('../src/app/api/plaid/exchange-token/route.ts');
const {POST:update}=await import('../src/app/api/plaid/update-link-token/route.ts');
const {POST:sync}=await import('../src/app/api/plaid/sync/route.ts');
const request=body=>new Request('https://finance.example/api/plaid/test',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{globalThis.plaidTest={denied:null,existing:[],items:[{item_id:'old',access_token:'bad',institution_name:'Bank',cursor:null},{item_id:'other',access_token:'good',institution_name:'Other',cursor:null}],attempted:[],updated:[],errors:[],linkRequests:[],exchanged:0,saved:0};});
test('failed bank does not stop other banks from syncing; warning contains the actual action',async()=>{
  const result=await syncAllItems();
  assert.equal(result.synced,1);assert.equal(result.failures.length,1);
  assert.deepEqual(globalThis.plaidTest.attempted,['bad','good']);
  assert.deepEqual(globalThis.plaidTest.updated,['other']);
  assert.match(globalThis.plaidTest.errors[0].message,/no longer has access/);
});
test('update mode uses existing access token and no new-connection products',async()=>{
  assert.equal(await createUpdateLinkToken('existing-token'),'update-token');
  const r=globalThis.plaidTest.linkRequests[0];
  assert.equal(r.access_token,'existing-token');assert.equal(r.products,undefined);assert.equal(r.update.account_selection_enabled,true);
});
test('duplicate bank is rejected before access-token exchange or database save',async()=>{
  globalThis.plaidTest.existing=[{item_id:'old'}];
  const response=await exchange(request({publicToken:'public',institution:{id:'bank',name:'Bank'}}));
  assert.equal(response.status,409);assert.equal(globalThis.plaidTest.exchanged,0);assert.equal(globalThis.plaidTest.saved,0);
});
test('repair requires authentication and a known item',async()=>{
  globalThis.plaidTest.denied=Response.json({error:'Unauthorized'},{status:401});
  assert.equal((await update(request({itemId:'old'}))).status,401);
  globalThis.plaidTest.denied=null;
  assert.equal((await update(request({itemId:'unknown'}))).status,404);
  assert.equal((await update(request({}))).status,400);
  assert.equal(globalThis.plaidTest.linkRequests.length,0);
});
test('repair completion syncs only the repaired bank',async()=>{
  assert.equal((await sync(request({itemId:'other'}))).status,200);
  assert.deepEqual(globalThis.plaidTest.attempted,['good']);
});
test('all-bank sync reports partial results without hiding failed connections',async()=>{
  const response=await sync(new Request('https://finance.example/api/plaid/sync',{method:'POST'}));
  const result=await response.json();assert.equal(result.ok,false);assert.equal(result.synced,1);assert.equal(result.failures[0].institutionName,'Bank');
});
test('missing institution metadata cannot bypass duplicate protection',async()=>{
  assert.equal((await exchange(request({publicToken:'public'}))).status,400);
  assert.equal((await exchange(request({publicToken:'public',institution:{name:' '}}))).status,400);
  assert.equal(globalThis.plaidTest.exchanged,0);
});
