// رضا بلاتفورم إكسبوزي — الخادم (بدون أي اعتماد على express)
// التشغيل:  GEMINI_API_KEY=مفتاحك node server.js   (المفتاح مجاني من aistudio.google.com)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildDocx } = require('./docx-export');

const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- الذكاء الاصطناعي ----------
async function gemini(prompt, json = false) {
  if (!KEY) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
  });
  if (!r.ok) throw new Error('تعذّر الاتصال بالذكاء الاصطناعي: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

const RULES = 'اكتب بعربية أكاديمية فصيحة وسليمة، بأسلوب بحث جامعي. لا تختلق أرقام مواد قانونية أو أحكامًا قضائية أو مراجع أو إحصائيات؛ ' +
  'وإن احتجت إلى سند فاذكره بصيغة عامة. لا تستعمل رموز Markdown مثل ** أو #. افصل الفقرات بسطر فارغ، واستعمل "- " فقط للقوائم عند الحاجة.';

async function plan({ title, field, chapters = 2, depth = 2, system = 'mabhath' }) {
  const n = Math.min(Math.max(+chapters || 2, 1), 5);
  const d = depth === 3 ? 3 : 2;
  const prompt = `أنت أستاذ جامعي. ضع خطة بحث جامعي عنوانها: «${title}» في تخصص: ${field || 'عام'}.
أعد JSON فقط بهذا الشكل: {"chapters":[{"title":"...","subs":[{"title":"...","subs":[{"title":"..."}]}]}]}
- عدد ${system === 'fasl' ? 'الفصول' : 'المباحث'}: ${n}، ولكل واحد منها مطلبان (subs).
${d === 3 ? '- لكل مطلب فرعان (subs داخلية).' : '- لا تضع subs داخل المطالب (اتركها مصفوفة فارغة).'}
- العناوين مختصرة ودقيقة ولا تتضمن كلمات الترقيم مثل "المبحث الأول".`;
  const t = await gemini(prompt, true);
  if (!t) return { demo: true, chapters: demoPlan(n, d) };
  const parsed = JSON.parse(t.replace(/^```json|```$/g, ''));
  return { chapters: parsed.chapters || [] };
}

function demoPlan(n, d) {
  const names = ['الإطار المفاهيمي والنظري', 'الأحكام والآثار القانونية', 'الإشكالات العملية', 'الضمانات والرقابة', 'آفاق التطوير'];
  return Array.from({ length: n }, (_, i) => ({
    title: names[i] || `محور ${i + 1}`,
    subs: ['تعريف وتحديد المفاهيم', 'الأساس والخصائص'].map((t) => ({
      title: t, subs: d === 3 ? [{ title: 'العنصر الأول' }, { title: 'العنصر الثاني' }] : [] })),
  }));
}

async function write({ title, heading, parents, words = 220, instruction = '' }) {
  const prompt = `${RULES}
موضوع البحث: «${title}».
${parents ? 'موقع العنوان في الخطة: ' + parents + '.' : ''}
اكتب نص العنوان: «${heading}» في نحو ${words} كلمة، دون تكرار العنوان في أول النص.
${instruction ? 'تعليمات إضافية من الطالب: ' + instruction : ''}`;
  const t = await gemini(prompt);
  return t || `هذا نص تجريبي لعنوان «${heading}». أضف مفتاح GEMINI_API_KEY لتشغيل الكتابة بالذكاء الاصطناعي، ثم أعد توليد هذا القسم.`;
}

const MODES = {
  rewrite: 'أعد صياغة النص التالي بأسلوب أكاديمي أرقى مع الحفاظ على المعنى كاملًا.',
  simplify: 'بسّط النص التالي وأوضحه بعبارات أسهل دون الإخلال بالمعنى.',
  expand: 'وسّع النص التالي بإضافة شرح وأمثلة وتحليل، ليصبح أطول بنحو الضعف.',
  shorten: 'لخّص النص التالي في نحو نصف طوله مع إبقاء الأفكار الأساسية.',
  proofread: 'دقّق النص التالي لغويًا ونحويًا وإملائيًا، وصحّح علامات الترقيم دون تغيير الأسلوب.',
  custom: '',
};
async function rewrite({ text, mode, instruction }) {
  const prompt = `${RULES}\n${MODES[mode] || ''} ${instruction || ''}\nأعد النص المعدَّل فقط دون أي تعليق.\n\nالنص:\n${text}`;
  const t = await gemini(prompt);
  return t || text;
}

// ---------- الخادم ----------
const readBody = (req) => new Promise((res, rej) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) { req.destroy(); rej(new Error('too large')); } });
  req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
});
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ai: !!KEY });
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
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
