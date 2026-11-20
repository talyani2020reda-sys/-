// رضا بلاتفورم إكسبوزي — الخادم (بدون أي اعتماد على express)
// التشغيل:  GEMINI_API_KEY=مفتاحك node server.js   (المفتاح مجاني من aistudio.google.com)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildDocx } = require('./docx-export');
const { searchRefs } = require('./refs');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- الذكاء الاصطناعي ----------
const ai = require('./ai');
const KEY = ai.enabled;
const demoPlan = (n, d) => {
  const names = ['الإطار المفاهيمي والنظري', 'الأحكام والآثار القانونية', 'الإشكالات العملية', 'الضمانات والرقابة', 'آفاق التطوير'];
  return Array.from({ length: n }, (_, i) => ({ title: names[i] || `محور ${i + 1}`,
    subs: ['تعريف وتحديد المفاهيم', 'الأساس والخصائص'].map((t) => ({ title: t, subs: d === 3 ? [{ title: 'العنصر الأول' }, { title: 'العنصر الثاني' }] : [] })) }));
};
async function plan(b) {
  const r = await ai.plan(b);
  if (r) return r;
  return { demo: true, chapters: demoPlan(Math.min(Math.max(+b.chapters || 2, 1), 5), +b.depth === 3 ? 3 : 2) };
}
async function write(b) {
  const t = await ai.write(b);
  return t || `هذا نص تجريبي لعنوان «${b.heading}». أضف مفتاح GEMINI_API_KEY لتشغيل الكتابة بالذكاء الاصطناعي، ثم أعد توليد هذا القسم.`;
}
async function rewrite(b) { return (await ai.rewrite(b)) || b.text; }

// ---------- الخادم ----------
const readBody = (req) => new Promise((res, rej) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) { req.destroy(); rej(new Error('too large')); } });
  req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
});
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ai: KEY, models: ai.models });
    if (req.method === 'GET' && url.pathname === '/api/refs') return send(res, 200, await searchRefs(url.searchParams.get('q')));
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      if (url.pathname !== '/api/export' && ai.limited(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x')) return send(res, 429, { error: 'عدد كبير من الطلبات. انتظر قليلًا ثم أعد المحاولة.' });
      if (url.pathname === '/api/plan') return send(res, 200, await plan(body));
      if (url.pathname === '/api/write') return send(res, 200, { text: await write(body) });
      if (url.pathname === '/api/rewrite') return send(res, 200, { text: await rewrite(body) });
      if (url.pathname === '/api/export') {
        const buf = await buildDocx(body);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent((body.meta?.title || 'بحث').slice(0, 60) + '.docx'),
        });
        return res.end(buf);
      }
      return send(res, 404, { error: 'not found' });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
    res.writeHead(404); return res.end('404');
  } catch (e) {
    console.error(e); send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}  —  الذكاء الاصطناعي: ${KEY ? 'مفعّل' : 'غير مفعّل (وضع تجريبي)'}`));
