const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3210);
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}
const J = { 'Content-Type': 'application/json' };
const post = (p, b, h) => j(p, { method: 'POST', headers: Object.assign({}, J, h || {}), body: JSON.stringify(b) });
const put = (p, b, h) => j(p, { method: 'PUT', headers: Object.assign({}, J, h || {}), body: JSON.stringify(b) });

const TEXT_A = [
  '1. 中国的首都是哪座城市？（2分）', 'A. 北京', 'B. 上海', 'C. 广州', 'D. 深圳', '答案：A', '',
  '2. 请写出三种三原色（3分）', '答案：红色、绿色、蓝色', '',
  '3. 下列哪个不是编程语言？', 'A. Python', 'B. Java', 'C. HTML', 'D. Go', '答案：C'
].join('\n');
const TEXT_B = [
  '1. 1 + 1 = ?', 'A. 1', 'B. 2', 'C. 3', '答案：B', '',
  '2. 请写出两种水果', '答案：苹果、香蕉'
].join('\n');

(async () => {
  console.log('\n--- 1. 公开接口 ---');
  let r = await j('/api/config');
  ok('config', r.body && r.body.ok, r.body);
  r = await j('/api/papers');
  ok('首页试卷列表（仅已发布）', r.status === 200 && Array.isArray(r.body.papers), r.body);

  console.log('\n--- 2. 鉴权 ---');
  r = await post('/api/admin/login', { password: 'nope' });
  ok('错误密码 401', r.status === 401);
  r = await j('/api/admin/papers');
  ok('无 token 401', r.status === 401);
  r = await post('/api/admin/login', { password: PASSWORD });
  ok('登录成功', r.body && r.body.ok && r.body.token, r.body);
  const H = { 'x-admin-token': r.body.token };

  console.log('\n--- 3. 新建试卷（自动生成链接） ---');
  r = await post('/api/admin/papers', { title: '语文测验' }, H);
  ok('新建成功', r.body && r.body.ok, r.body);
  const pA = r.body.paper;
  const A = pA.id;
  ok('自动生成 8 位试卷码', /^[A-Z0-9]{8}$/.test(pA.code), pA.code);
  ok('自动生成链接', pA.url === BASE + '/p/' + pA.code, pA.url);
  ok('默认草稿状态', pA.status === 'draft');

  r = await post('/api/admin/papers', { title: '数学小测' }, H);
  const pB = r.body.paper;
  const B = pB.id;
  ok('第二套试卷码不同', pA.code !== pB.code, [pA.code, pB.code]);

  console.log('\n--- 4. 空试卷不能发布 ---');
  r = await post(`/api/admin/papers/${A}/publish`, { published: true }, H);
  ok('空试卷发布被拒 400', r.status === 400, r.body);
  r = await j('/api/papers/' + pA.code);
  ok('草稿试卷公开访问 404', r.status === 404, r.body);

  console.log('\n--- 5. 导入题目（限定在本套内） ---');
  r = await post(`/api/admin/papers/${A}/preview`, { text: TEXT_A }, H);
  ok('预览解析 3 题', r.body.count === 3, r.body.count);
  ok('分值识别', r.body.questions[0].points === 2 && r.body.questions[1].points === 3, r.body.questions.map(q => q.points));
  r = await post(`/api/admin/papers/${A}/import`, { text: TEXT_A, replace: true }, H);
  ok('导入语文题 3 道', r.body.added === 3 && r.body.total === 3, r.body);
  r = await post(`/api/admin/papers/${B}/import`, { text: TEXT_B, replace: true }, H);
  ok('导入数学题 2 道', r.body.added === 2 && r.body.total === 2, r.body);

  r = await j(`/api/admin/papers/${A}`, { headers: H });
  ok('试卷 A 有 3 题', r.body.questions.length === 3, r.body.questions.length);
  r = await j(`/api/admin/papers/${B}`, { headers: H });
  ok('试卷 B 有 2 题（互不影响）', r.body.questions.length === 2, r.body.questions.length);

  console.log('\n--- 6. 发布与答题 ---');
  r = await post(`/api/admin/papers/${A}/publish`, { published: true }, H);
  ok('发布 A', r.body.ok && r.body.paper.status === 'published', r.body.paper && r.body.paper.status);
  await post(`/api/admin/papers/${B}/publish`, { published: true }, H);

  r = await j('/api/papers');
  ok('首页出现 2 套（外加迁移的默认卷）', r.body.papers.length >= 2, r.body.papers.length);

  r = await j('/api/papers/' + pA.code);
  ok('公开读取 A 元信息', r.body.paper.title === '语文测验' && r.body.paper.questionCount === 3, r.body.paper);
  const meta = r.body.paper;

  r = await post(`/api/papers/${pA.code}/questions`, {});
  ok('取题成功且不含答案', r.body.questions.length === 3 &&
    JSON.stringify(r.body.questions).indexOf('correctIndex') === -1 &&
    JSON.stringify(r.body.questions).indexOf('answers') === -1, r.body);

  const qsA = r.body.questions;
  const byTitle = (t) => qsA.find((q) => q.title.indexOf(t) === 0);

  let answers = {};
  answers[byTitle('中国的首都').id] = byTitle('中国的首都').options.indexOf('北京');
  answers[byTitle('请写出三种三原色').id] = '红色、绿色、蓝色';
  answers[byTitle('下列哪个不是编程语言').id] = byTitle('下列哪个不是编程语言').options.indexOf('HTML');
  r = await post(`/api/papers/${pA.code}/submit`, { name: '小全对', answers });
  ok('提交满分', r.body.ok && r.body.percent === 100, r.body);
  const fullId = r.body.id;

  answers = {};
  answers[byTitle('中国的首都').id] = byTitle('中国的首都').options.indexOf('上海');
  answers[byTitle('请写出三种三原色').id] = '红色、绿色';
  r = await post(`/api/papers/${pA.code}/submit`, { name: '小粗心', answers });
  const mixedId = r.body.id;
  ok('提交部分分', r.body.ok, r.body);

  r = await j('/api/result/' + mixedId);
  const res = r.body.result;
  ok('成绩带试卷信息', res.paperTitle === '语文测验' && res.paperCode === pA.code, res.paperTitle);
  ok('满分 2+3+1=6', res.fullSum === 6, res.fullSum);
  const d = (t) => res.details.find((x) => x.title.indexOf(t) === 0);
  ok('单选答错 wrong', d('中国的首都').status === 'wrong');
  ok('简答部分正确', d('请写出三种三原色').status === 'partial' && d('请写出三种三原色').earned === 2, d('请写出三种三原色'));
  ok('未作答 blank', d('下列哪个不是编程语言').status === 'blank');

  console.log('\n--- 7. 试卷之间完全隔离 ---');
  r = await post(`/api/papers/${pB.code}/questions`, {});
  ok('B 只返回自己的 2 题', r.body.questions.length === 2, r.body.questions.map(q => q.title));
  ok('B 的题目里没有 A 的题', r.body.questions.every((q) => q.title.indexOf('首都') < 0 && q.title.indexOf('三原色') < 0));

  r = await j('/api/admin/submissions?paperId=' + A, { headers: H });
  ok('按试卷筛选成绩 = 2 条', r.body.submissions.length === 2, r.body.submissions.length);
  r = await j('/api/admin/submissions?paperId=' + B, { headers: H });
  ok('B 的成绩为空', r.body.submissions.length === 0, r.body.submissions.length);
  r = await j('/api/admin/submissions', { headers: H });
  ok('不筛选返回全部', r.body.submissions.length >= 2, r.body.submissions.length);
  ok('成绩记录带试卷名', r.body.submissions.every((s) => !!s.paperTitle));

  // 改 B 的题目不影响 A
  const bTitle = (await j(`/api/admin/papers/${B}`, { headers: H })).body.questions[0].title;
  const bQid = (await j(`/api/admin/papers/${B}`, { headers: H })).body.questions[0].id;
  await put(`/api/admin/papers/${B}/questions/${bQid}`, { type: 'short', title: '改过的题', answers: ['x'], points: 5 }, H);
  r = await j(`/api/admin/papers/${A}`, { headers: H });
  ok('改 B 不影响 A', !r.body.questions.some((q) => q.title === '改过的题'));

  console.log('\n--- 8. 答题口令 ---');
  r = await put(`/api/admin/papers/${A}`, { accessCode: 'kou123' }, H);
  ok('设置口令', r.body.ok && r.body.paper.accessCode === 'kou123', r.body.paper && r.body.paper.accessCode);
  ok('元信息标记需要口令', r.body.paper.needAccessCode === true);
  r = await post(`/api/papers/${pA.code}/questions`, {});
  ok('口令错误被拒 403', r.status === 403, r.body);
  r = await post(`/api/papers/${pA.code}/questions`, { accessCode: 'wrong' });
  ok('口令错误被拒 403', r.status === 403);
  r = await post(`/api/papers/${pA.code}/questions`, { accessCode: 'kou123' });
  ok('口令正确可取题', r.status === 200 && r.body.questions.length === 3);
  r = await post(`/api/papers/${pA.code}/submit`, { name: 'x', answers: {} });
  ok('提交也必须带口令', r.status === 403);
  await put(`/api/admin/papers/${A}`, { accessCode: '' }, H);
  r = await post(`/api/papers/${pA.code}/questions`, {});
  ok('清空口令后可直接取题', r.status === 200);

  console.log('\n--- 9. 试卷级设置覆盖全局 ---');
  r = await put(`/api/admin/papers/${A}`, { passPercent: 90, partialCredit: false }, H);
  ok('试卷自定义及格线 90', r.body.paper.passPercent === 90, r.body.paper.passPercent);
  answers = {};
  answers[byTitle('中国的首都').id] = byTitle('中国的首都').options.indexOf('北京');
  answers[byTitle('请写出三种三原色').id] = '红色、绿色、蓝色';
  r = await post(`/api/papers/${pA.code}/submit`, { name: '刚好5分', answers });
  let rr = await j('/api/result/' + r.body.id);
  ok('83.33% 未达 90% 及格线', rr.body.result.percent > 80 && rr.body.result.pass === false, rr.body.result.percent + ' pass=' + rr.body.result.pass);
  ok('关闭部分给分后简答只给 0 或满分', rr.body.result.details.filter(x => x.type === 'short').every(x => x.status === 'correct'));

  console.log('\n--- 10. 复制试卷 ---');
  r = await post(`/api/admin/papers/${A}/duplicate`, {}, H);
  const copy = r.body.paper;
  ok('复制成功', r.body.ok && copy.id !== A, r.body);
  ok('副本是新码', copy.code !== pA.code, copy.code);
  ok('副本为草稿', copy.status === 'draft');
  r = await j(`/api/admin/papers/${copy.id}`, { headers: H });
  ok('副本题目相同但 id 不同', r.body.questions.length === 3 &&
    !r.body.questions.some((q) => (qsA || []).some((x) => x.id === q.id)), r.body.questions.length);

  console.log('\n--- 11. 题目增删改排序（本套内） ---');
  r = await post(`/api/admin/papers/${B}/questions`, { type: 'short', title: '新增题', answers: ['甲', '乙'], points: 2 }, H);
  ok('新增题目', r.body.ok && r.body.index === 3, r.body);
  const newQid = r.body.question.id;
  r = await post(`/api/admin/papers/${B}/questions/reorder`, { ids: [newQid] }, H);
  ok('排序（置顶）', r.body.ok && r.body.count === 3, r.body);
  r = await j(`/api/admin/papers/${B}`, { headers: H });
  ok('新题排到第一位', r.body.questions[0].id === newQid);
  r = await j(`/api/admin/papers/${B}/questions/${newQid}`, { method: 'DELETE', headers: H });
  ok('删除题目', r.body.ok, r.body);

  console.log('\n--- 12. 404 / 校验 ---');
  r = await j('/api/papers/ZZZZZZZZ');
  ok('不存在的试卷码 404', r.status === 404, r.body);
  r = await j('/api/admin/papers/not-exist', { headers: H });
  ok('不存在的试卷 id 404', r.status === 404);
  r = await post('/api/admin/papers/not-exist/questions', { type: 'short', title: 'x', answers: ['a'] }, H);
  ok('往不存在试卷加题 404', r.status === 404);
  r = await post(`/api/admin/papers/${B}/questions`, { type: 'single', title: 'x', options: ['只有一个'], correctIndex: 0 }, H);
  ok('选项不足 400', r.status === 400);
  r = await post(`/api/papers/${pA.code}/submit`, { name: '', answers: {} });
  ok('空姓名 400', r.status === 400);
  r = await j('/api/questions');
  ok('旧的单试卷接口已移除 404', r.status === 404, r.status);

  console.log('\n--- 13. 导出 ---');
  const csv = await fetch(BASE + '/api/admin/export?format=csv&paperId=' + A, { headers: H });
  const csvText = await csv.text();
  ok('CSV 含试卷列', csvText.indexOf('试卷') >= 0 && csvText.indexOf('小全对') >= 0);
  ok('CSV 只含本套', csvText.indexOf('语文测验') >= 0);
  const js = await j('/api/admin/export?format=json&paperId=' + A, { headers: H });
  ok('JSON 导出本套题库', js.body.questions.length === 3 && js.body.title === '语文测验');
  const all = await j('/api/admin/export?format=json', { headers: H });
  ok('JSON 导出全部试卷', Array.isArray(all.body.papers) && all.body.papers.length >= 3);

  console.log('\n--- 14. 删除试卷连带成绩 ---');
  r = await j('/api/admin/submissions?paperId=' + A, { headers: H });
  const cntA = r.body.submissions.length;
  r = await j(`/api/admin/papers/${A}`, { method: 'DELETE', headers: H });
  ok('删除试卷返回连带删除数', r.body.ok && r.body.removedSubmissions === cntA, r.body);
  r = await j(`/api/admin/papers/${A}`, { headers: H });
  ok('试卷已不存在', r.status === 404);
  r = await j('/api/admin/submissions?paperId=' + A, { headers: H });
  ok('其成绩也清空', r.body.submissions.length === 0, r.body.submissions.length);
  r = await j('/api/papers/' + pA.code);
  ok('删除后短链 404', r.status === 404);

  console.log('\n--- 15. 短链答题页 ---');
  const page = await fetch(BASE + '/p/' + pB.code);
  const html = await page.text();
  ok('GET /p/CODE -> 200', page.status === 200, page.status);
  ok('返回的是答题页', html.indexOf('exam.js') >= 0 && html.indexOf('④ 提交答卷') >= 0);
  ok('路径不影响静态资源', html.indexOf('/js/common.js') >= 0);
  for (const path of ['/', '/admin', '/exam.html', '/result.html', '/js/qrcode.js', '/js/home.js', '/js/exam.js', '/js/admin.js']) {
    const resp = await fetch(BASE + path);
    ok('GET ' + path + ' -> ' + resp.status, resp.status === 200);
  }

  console.log('\n--- 16. 统计与排序 ---');
  r = await post('/api/admin/papers', { title: '统计用卷' }, H);
  const C = r.body.paper.id;
  await post(`/api/admin/papers/${C}/import`, {
    text: ['1. 1+1=?（2分）', 'A. 1', 'B. 2', 'C. 3', '答案：B', '', '2. 写出两种颜色（3分）', '答案：红色、蓝色'].join('\n'),
    replace: true
  }, H);
  await post(`/api/admin/papers/${C}/publish`, { published: true }, H);
  const cCode = (await j('/api/admin/papers/' + C, { headers: H })).body.paper.code;
  const cQs = (await post(`/api/papers/${cCode}/questions`, {})).body.questions;
  const cq1 = cQs[0], cq2 = cQs[1];

  // 甲：全对(5/5=100%)  乙：单选错(3/5=60%)  丙：全空(0%)  甲再交一次全错(0%)
  await post(`/api/papers/${cCode}/submit`, { name: '甲', answers: { [cq1.id]: 1, [cq2.id]: '红色、蓝色' } });
  await post(`/api/papers/${cCode}/submit`, { name: '乙', answers: { [cq1.id]: 0, [cq2.id]: '红色、蓝色' } });
  await post(`/api/papers/${cCode}/submit`, { name: '丙', answers: {} });
  await post(`/api/papers/${cCode}/submit`, { name: '甲', answers: { [cq1.id]: 0, [cq2.id]: 'x' } });

  r = await j(`/api/admin/papers/${C}/stats`, { headers: H });
  const st = r.body;
  ok('统计接口返回 ok', st.ok === true, r.status);
  const o = st.overview;
  ok('提交份数 = 4', o.submissions === 4, o.submissions);
  ok('参与人数 = 3（同名合并）', o.students === 3, o.students);
  ok('平均得分率 = 40%', o.avgPercent === 40, o.avgPercent);
  ok('中位数 = 30%', o.medianPercent === 30, o.medianPercent);
  ok('最高 100 / 最低 0', o.maxPercent === 100 && o.minPercent === 0, [o.maxPercent, o.minPercent]);
  ok('满分 2+3 = 5 分', o.totalPoints === 5, o.totalPoints);
  ok('及格人数 = 2', o.passCount === 2, o.passCount);
  ok('及格率 = 50%', o.passRate === 50, o.passRate);

  ok('分数分布 10 档', st.distribution.length === 10, st.distribution.length);
  const bucket = (label) => (st.distribution.find((d) => d.label === label) || {}).count;
  ok('90-100 档 1 份', bucket('90-100') === 1, st.distribution);
  ok('60-70 档 1 份', bucket('60-70') === 1, st.distribution);
  ok('0-10 档 2 份', bucket('0-10') === 2, st.distribution);
  ok('分布合计 = 提交数', st.distribution.reduce((a, d) => a + d.count, 0) === o.submissions);

  ok('题目统计 2 条', st.questions.length === 2, st.questions.length);
  const sq1 = st.questions.find((x) => x.qid === cq1.id);
  const sq2 = st.questions.find((x) => x.qid === cq2.id);
  ok('单选题分值 2 分', sq1.points === 2, sq1.points);
  ok('单选：对1 错2 未答1 = 4 份', sq1.scored === 4 && sq1.correct === 1 && sq1.wrong === 2 && sq1.blank === 1,
    [sq1.scored, sq1.correct, sq1.wrong, sq1.blank]);
  ok('单选：正确率 25%', sq1.correctRate === 25, sq1.correctRate);
  ok('单选：平均得分 0.5/2', sq1.avgEarned === 0.5, sq1.avgEarned);
  ok('单选：选项分布 A=2 B=1 C=0 且 B 为答案',
    sq1.options.length === 3 && sq1.options[0].count === 2 && sq1.options[1].count === 1 &&
    sq1.options[2].count === 0 && sq1.options[1].isCorrect === true, sq1.options);
  ok('简答：对2 错1 未答1', sq2.correct === 2 && sq2.wrong === 1 && sq2.blank === 1,
    [sq2.correct, sq2.wrong, sq2.blank]);
  ok('简答：正确率 50%', sq2.correctRate === 50, sq2.correctRate);
  ok('简答：平均得分 1.5/3', sq2.avgEarned === 1.5, sq2.avgEarned);
  ok('简答：常见错误答案 = x', sq2.topWrong.length >= 1 && sq2.topWrong[0].value === 'x', sq2.topWrong);

  ok('按人统计 3 人', st.students.length === 3, st.students.length);
  const jia = st.students.find((x) => x.name === '甲');
  ok('甲：提交 2 次 / 最高 100 / 平均 50',
    jia.attempts === 2 && jia.bestPercent === 100 && jia.avgPercent === 50, jia);
  ok('按人默认最高分降序', st.students[0].name === '甲' && st.students[0].bestPercent === 100,
    st.students.map((x) => x.name));
  const bing = st.students.find((x) => x.name === '丙');
  ok('丙：未及格', bing && bing.pass === false && bing.bestPercent === 0, bing);

  console.log('\n--- 17. 成绩筛选 ---');
  const q = (params) => j('/api/admin/submissions?' + params, { headers: H });
  const cnt = async (params) => (await q(params)).body.submissions.length;

  ok('不带条件 = 全部 4 条', await cnt('paperId=' + C) === 4);
  ok('按姓名：甲 → 2 条', await cnt(`paperId=${C}&name=甲`) === 2, await cnt(`paperId=${C}&name=甲`));
  ok('按姓名片段：多/不存在 → 0', await cnt(`paperId=${C}&name=不存在的人`) === 0);
  ok('按及格：仅及格 → 2 条', await cnt(`paperId=${C}&pass=true`) === 2, await cnt(`paperId=${C}&pass=true`));
  ok('按及格：仅不及格 → 2 条', await cnt(`paperId=${C}&pass=false`) === 2);
  ok('按得分率 ≥50 → 2 条', await cnt(`paperId=${C}&minPercent=50`) === 2);
  ok('按得分率 50~80 → 1 条', await cnt(`paperId=${C}&minPercent=50&maxPercent=80`) === 1);
  ok('按得分率 0~10 → 2 条', await cnt(`paperId=${C}&minPercent=0&maxPercent=10`) === 2);

  ok('按试题（不限结果）→ 4 条', await cnt(`paperId=${C}&qid=${cq1.id}&qstatus=any`) === 4);
  ok('按试题：第1题答对 → 1 条', await cnt(`paperId=${C}&qid=${cq1.id}&qstatus=correct`) === 1);
  ok('按试题：第1题答错 → 2 条', await cnt(`paperId=${C}&qid=${cq1.id}&qstatus=wrong`) === 2);
  ok('按试题：第1题未答 → 1 条', await cnt(`paperId=${C}&qid=${cq1.id}&qstatus=blank`) === 1);
  ok('按试题：第2题答对 → 2 条', await cnt(`paperId=${C}&qid=${cq2.id}&qstatus=correct`) === 2);

  r = await q(`paperId=${C}&qid=${cq1.id}&qstatus=wrong`);
  const row0 = r.body.submissions[0];
  ok('带出该题作答情况', row0.qStatus === 'wrong' && row0.qFull === 2 && typeof row0.qUserDisplay === 'string',
    { qStatus: row0.qStatus, qFull: row0.qFull, qUserDisplay: row0.qUserDisplay });

  const today = new Date().toISOString().slice(0, 10);
  ok('按日期：今天 → 4 条', await cnt(`paperId=${C}&from=${today}`) === 4);
  ok('按日期：2099 年起 → 0 条', await cnt(`paperId=${C}&from=2099-01-01`) === 0);

  ok('多条件组合（甲 + 及格）→ 1 条', await cnt(`paperId=${C}&name=甲&pass=true`) === 1);
  ok('筛选不会跨试卷', await cnt('paperId=' + C + '&name=' + encodeURIComponent('浏览器测试')) === 0);

  console.log('\n--- 17.5 统计导出 ---');
  const qcsv = await (await fetch(BASE + '/api/admin/export?format=csv&type=questions&paperId=' + C, { headers: H })).text();
  ok('题目统计 CSV 表头', qcsv.indexOf('正确率(%)') >= 0 && qcsv.indexOf('未作答') >= 0);
  ok('题目统计 CSV 含数据', qcsv.indexOf('写出两种颜色') >= 0);
  const scsv = await (await fetch(BASE + '/api/admin/export?format=csv&type=students&paperId=' + C, { headers: H })).text();
  ok('人员统计 CSV 表头', scsv.indexOf('提交次数') >= 0 && scsv.indexOf('最高得分率(%)') >= 0);
  ok('人员统计 CSV 含姓名', scsv.indexOf('甲') >= 0 && scsv.indexOf('丙') >= 0);
  await j(`/api/admin/papers/${C}`, { method: 'DELETE', headers: H });

  console.log('\n--- 18. 清理 ---');
  await j(`/api/admin/papers/${B}`, { method: 'DELETE', headers: H });
  await j(`/api/admin/papers/${copy.id}`, { method: 'DELETE', headers: H });
  r = await j('/api/admin/papers', { headers: H });
  console.log('  >> 剩余试卷: ' + r.body.papers.map((x) => x.title).join(', '));

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
