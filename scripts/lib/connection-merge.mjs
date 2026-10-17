// Deliberately conservative: this is an operator-run repair, never an automatic mask-based merge.
export function planConnectionMerge({ items, accounts, transactions, settings, snapshots, keepId, removeIds }) {
  const keep = items.find(i => i.item_id === keepId);
  if (!keep || keep.status !== 'healthy' || !removeIds.length || removeIds.includes(keepId)) throw new Error('Choose a healthy replacement and distinct old connections');
  const oldItems = removeIds.map(id => items.find(i => i.item_id === id));
  if (oldItems.some(i => !i || i.institution_name !== keep.institution_name)) throw new Error('Institution mismatch');
  const targets = accounts.filter(a => a.item_id === keepId);
  const sources = accounts.filter(a => removeIds.includes(a.item_id));
  if (!sources.length) throw new Error('No source accounts');
  const accountMap = new Map();
  for (const source of sources) {
    const matches = targets.filter(a => source.mask && a.mask === source.mask && a.name === source.name && a.type === source.type && a.subtype === source.subtype && a.currency === source.currency);
    if (matches.length !== 1 || [...accountMap.values()].includes(matches[0].account_id)) throw new Error('Account match is ambiguous; review manually');
    accountMap.set(source.account_id, matches[0].account_id);
  }
  const signature = t => JSON.stringify([t.transaction_date,t.amount,t.currency,t.name,t.pending]);
  const statements = [];
  const transactionMap = new Map();
  const oldTransactions = transactions.filter(t => removeIds.includes(t.item_id));
  let matched = 0, preserved = 0, categories = 0;
  for (const [oldAccount, newAccount] of accountMap) {
    const fresh = transactions.filter(t => t.account_id === newAccount);
    const earliest = fresh.map(t => t.transaction_date).sort()[0];
    const available = new Map();
    for (const t of fresh) available.set(signature(t), [...(available.get(signature(t)) || []), t]);
    for (const old of oldTransactions.filter(t => t.account_id === oldAccount)) {
      const target = available.get(signature(old))?.shift();
      if (target) {
        if (old.user_category && target.user_category && old.user_category !== target.user_category) throw new Error('Conflicting custom categories');
        if (old.user_category) {
          statements.push({sql:'UPDATE transactions SET user_category = ?, category_source = ? WHERE transaction_id = ?', args:[old.user_category,old.category_source,target.transaction_id]});
          categories++;
        }
        transactionMap.set(old.transaction_id, target.transaction_id);
        statements.push({sql:'DELETE FROM transactions WHERE transaction_id = ?',args:[old.transaction_id]});
        matched++;
      } else {
        // Anything inside the new import window might be a changed/pending duplicate.
        if (old.pending || !earliest || old.transaction_date >= earliest) throw new Error('Unmatched transaction inside replacement history; review manually');
        statements.push({sql:'UPDATE transactions SET item_id = ?, account_id = ? WHERE transaction_id = ?',args:[keepId,newAccount,old.transaction_id]});
        preserved++;
      }
    }
  }
  if (matched + preserved !== oldTransactions.length) throw new Error('Unmapped transactions');
  for (const [oldId,newId] of transactionMap) statements.push({sql:'UPDATE transactions SET pending_transaction_id = ? WHERE pending_transaction_id = ?',args:[newId,oldId]});
  const mapSelection = value => JSON.stringify([...new Set(JSON.parse(value).map(id => accountMap.get(id) || id))].sort());
  const reserve = settings.find(s => s.key === 'tax_account_ids');
  if (reserve) statements.push({sql:"UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'tax_account_ids'",args:[mapSelection(reserve.value)]});
  for (const scope of new Set(snapshots.map(s => s.scope_key))) {
    const newScope = mapSelection(scope);
    if (newScope !== scope) {
      if (snapshots.some(s => s.scope_key === newScope)) throw new Error('Snapshot scope collision; review manually');
      statements.push({sql:'UPDATE tax_reserve_net_worth_snapshots SET scope_key = ? WHERE scope_key = ?',args:[newScope,scope]});
    }
  }
  for (const id of removeIds) {
    statements.push({sql:'DELETE FROM accounts WHERE item_id = ?',args:[id]});
    statements.push({sql:'DELETE FROM plaid_items WHERE item_id = ?',args:[id]});
  }
  return {statements,summary:{accountsMerged:accountMap.size,duplicateTransactions:matched,olderTransactionsPreserved:preserved,categoriesPreserved:categories}};
}
