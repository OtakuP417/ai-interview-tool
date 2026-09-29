/* 复现：对话超过 40 条时，前端 slice(0,40) 会丢掉最近的上下文 */
function countRounds(ms) { return (ms || []).filter(m => m.role === 'user' && !m.internal).length; }

// 按 #10 郭二鑫的真实规模造一份对话（21 轮 → 1 系统 + 21 问 + 21 答 = 43 条）
const msgs = [{ role: 'system', content: 'SYS' }];
for (let i = 1; i <= 21; i++) {
  msgs.push({ role: 'user', content: '第' + i + '问' });
  msgs.push({ role: 'assistant', content: '第' + i + '答' });
}
console.log('总消息数:', msgs.length, '| 有效轮次:', countRounds(msgs));

const sent = msgs.filter(m => m.role !== 'system' ? true : m).slice(0, 40);
console.log('实际发给模型:', sent.length, '条');
console.log('  首条:', sent[0].content);
console.log('  末条:', sent[sent.length - 1].content);
const dropped = msgs.slice(40);
console.log('被丢弃:', dropped.length, '条 →', dropped.map(m => m.content).join(', '));
console.log('');
// 关键：最后一条用户提问是否还在上下文里
const lastUser = msgs.filter(m => m.role === 'user').pop();
const inContext = sent.some(m => m.content === lastUser.content);
console.log('最后一条用户发言(' + lastUser.content + ') 是否在上下文:', inContext ? '在' : '★ 已丢失');
