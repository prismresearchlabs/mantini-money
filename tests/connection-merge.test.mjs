import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planConnectionMerge } from '../scripts/lib/connection-merge.mjs';
const fixture = () => ({
  keepId:'new', removeIds:['old'],
  items:[{item_id:'old',institution_name:'Bank'},{item_id:'new',institution_name:'Bank',status:'healthy'}],
  accounts:['old','new'].map(id=>({account_id:`${id}-account`,item_id:id,name:'Tax',mask:'1234',type:'depository',subtype:'savings',currency:'USD'})),
  transactions:[
    {transaction_id:'history',item_id:'old',account_id:'old-account',transaction_date:'2026-05-01',amount:12,currency:'USD',name:'History',pending:0},
    ...['old','new'].map(id=>({transaction_id:`${id}-txn`,item_id:id,account_id:`${id}-account`,transaction_date:'2026-06-01',amount:25,currency:'USD',name:'Purchase',pending:0,user_category:id==='old'?'Custom':null,category_source:id==='old'?'user':null})),
  ], settings:[{key:'tax_account_ids',value:'["old-account"]'}],snapshots:[{scope_key:'["old-account"]'}],
});
test('merge preserves older history, category overrides, tax selection and snapshot scope',()=>{
  const {summary,statements}=planConnectionMerge(fixture());
  assert.deepEqual(summary,{accountsMerged:1,duplicateTransactions:1,olderTransactionsPreserved:1,categoriesPreserved:1});
  assert.ok(statements.some(s=>s.sql.startsWith('UPDATE transactions SET item_id')&&s.args[2]==='history'));
  assert.ok(statements.some(s=>s.sql.includes('SET user_category')&&s.args[0]==='Custom'));
  assert.ok(statements.some(s=>s.sql.includes('UPDATE app_settings')&&s.args[0]==='["new-account"]'));
  assert.ok(statements.some(s=>s.sql.includes('UPDATE tax_reserve_net')&&s.args[0]==='["new-account"]'));
});
test('same-day repeated purchases are matched one-to-one, never collapsed by set membership',()=>{
  const f=fixture();for(const id of ['old','new'])f.transactions.push({...f.transactions.find(t=>t.transaction_id===`${id}-txn`),transaction_id:`${id}-second`});
  assert.equal(planConnectionMerge(f).summary.duplicateTransactions,2);
});
test('ambiguous account, pending history, conflicting categories and unmatched overlap stop the repair',()=>{
  for(const mutate of [
    f=>f.accounts.push({...f.accounts[1],account_id:'ambiguous'}),
    f=>f.transactions[0].pending=1,
    f=>f.transactions[2].user_category='Other',
    f=>f.transactions[0].transaction_date='2026-07-01',
    f=>f.accounts[1].currency='CAD',
    f=>f.snapshots.push({scope_key:'["new-account"]'}),
  ]){const f=fixture();mutate(f);assert.throws(()=>planConnectionMerge(f));}
});
