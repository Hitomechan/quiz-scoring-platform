/* 新建一套示例试卷（不会动到已有试卷）
 * 用法: node tools/seed-demo.js
 *   环境变量 PORT / ADMIN_PASSWORD 可覆盖默认值
 */
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3210);
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const SAMPLE = [
  '1. 中国的首都是哪座城市？（2分）',
  'A. 北京', 'B. 上海', 'C. 广州', 'D. 深圳',
  '答案：A', '',
  '2. 请写出三种三原色（3分）',
  '答案：红色、绿色、蓝色', '',
  '3. 下列哪个不是编程语言？',
  'A. Python', 'B. Java', 'C. HTML', 'D. Go',
  '答案：C', '',
  '4. 太阳从哪个方向升起？',
  'A. 东', 'B. 西', 'C. 南', 'D. 北',
  '答案：A', '',
  '5. 请说出两种常见的水果',
  '答案：苹果、香蕉'
].join('\n');

async function call(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  const res = await fetch(BASE + path, {
    method: method || 'GET',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.json();
}

(async () => {
  try {
    const login = await call('/api/admin/login', 'POST', { password: PASSWORD });
    if (!login.ok) throw new Error(login.error || '登录失败');
    const token = login.token;

    const created = await call('/api/admin/papers', 'POST', { title: '示例试卷' }, token);
    if (!created.ok) throw new Error(created.error);
    const id = created.paper.id;

    const imported = await call('/api/admin/papers/' + id + '/import', 'POST',
      { text: SAMPLE, replace: true }, token);
    if (!imported.ok) throw new Error(imported.error);

    const published = await call('/api/admin/papers/' + id + '/publish', 'POST', { published: true }, token);
    if (!published.ok) throw new Error(published.error);

    console.log('已创建示例试卷');
    console.log('  题数:', imported.total);
    console.log('  链接:', published.paper.url);
    console.log('  二维码: 在管理后台点该试卷的「二维码」按钮');
  } catch (e) {
    console.error('失败:', e.message);
    console.error('请确认服务已启动，且管理密码正确（默认 admin123）。');
    process.exit(1);
  }
})();
