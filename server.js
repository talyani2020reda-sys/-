// خادم النموذج الأولي لمولّد الأبحاث الجامعية
// تشغيل: GEMINI_API_KEY=مفتاحك node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Footer, PageNumber, PageBreak,
} = require('docx');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FONT = 'Arial';

// ---------- حدود الاستخدام (حماية بسيطة من استنزاف الحصة المجانية) ----------
const RATE_LIMIT = 60;               // عدد طلبات الذكاء الاصطناعي لكل IP في الساعة
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= RATE_LIMIT) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list); return true;
}

// ---------- استدعاء Gemini ----------
async function callGemini(prompt, { json = false } = {}) {
  if (!API_KEY) {
    const e = new Error('المتغير GEMINI_API_KEY غير مضبوط على الخادم.');
    e.status = 500; throw e;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) {
    const e = new Error(res.status === 429
      ? 'تم تجاوز حد الطلبات المجاني للنموذج، حاول بعد قليل.'
      : `خطأ من خدمة الذكاء الاصطناعي (${res.status}).`);
    e.status = res.status === 429 ? 429 : 502; throw e;
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text.trim()) { const e = new Error('رد فارغ من النموذج، أعد المحاولة.'); e.status = 502; throw e; }
  return text;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// ---------- المسارات ----------
async function outline(body) {
  const title = clean(body.title, 200);
  const field = clean(body.field, 100) || 'العلوم الجامعية';
  const pages = clamp(parseInt(body.pages, 10) || 10, 4, 60);
  if (!title) throw Object.assign(new Error('أدخل عنوان البحث.'), { status: 400 });
  const n = clamp(Math.round(pages / 4), 2, 8);
  const prompt = `أنت أستاذ جامعي متخصص في ${field}. ضع خطة بحث جامعي بعنوان: "${title}".
عدد الصفحات المطلوب تقريبًا: ${pages}.
أعد JSON فقط بهذا الشكل: {"sections":[{"title":"...","summary":"جملة واحدة عن محتوى القسم"}]}
الشروط: تبدأ الخطة بـ "مقدمة" وتنتهي بـ "خاتمة"، وبينهما ${n} مباحث مرتبة منطقيًا، بعناوين عربية واضحة بلا ترقيم.`;
  const raw = await callGemini(prompt, { json: true });
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```json|```$/g, '').trim()); }
  catch { throw Object.assign(new Error('تعذّر فهم خطة البحث، أعد المحاولة.'), { status: 502 }); }
  const sections = (parsed.sections || [])
    .map(s => ({ title: clean(s.title, 150), summary: clean(s.summary, 300) }))
    .filter(s => s.title).slice(0, 14);
  if (sections.length < 3) throw Object.assign(new Error('خطة غير مكتملة، أعد المحاولة.'), { status: 502 });
  return { sections };
}

async function section(body) {
  const title = clean(body.title, 200);
  const field = clean(body.field, 100) || 'العلوم الجامعية';
  const pages = clamp(parseInt(body.pages, 10) || 10, 4, 60);
  const sec = body.section || {};
  const titles = (Array.isArray(body.outline) ? body.outline : []).map(t => clean(t, 150)).slice(0, 14);
  if (!title || !clean(sec.title, 150)) throw Object.assign(new Error('بيانات ناقصة.'), { status: 400 });
  const words = clamp(Math.round((pages * 250) / Math.max(titles.length, 3)), 150, 900);
  const prompt = `اكتب قسم "${clean(sec.title, 150)}" من بحث جامعي بعنوان "${title}" في تخصص ${field}.
خطة البحث الكاملة: ${titles.join(' | ')}
ملخص هذا القسم: ${clean(sec.summary, 300)}
الطول المطلوب: نحو ${words} كلمة.
القواعد: لغة عربية أكاديمية رصينة؛ فقرات متصلة؛ لا تستخدم رموز Markdown؛ لا تخترع مراجع أو أرقام مواد قانونية أو أحكامًا قضائية أو إحصاءات؛ وإن احتجت إلى استشهاد فاكتفِ بإشارة عامة وضع بعدها [يُراجَع المصدر].
اكتب نص القسم فقط دون عنوانه.`;
  const text = await callGemini(prompt);
  return { text: text.trim() };
}

// ---------- تصدير Word (RTL) ----------
const font = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };
function run(text, opts = {}) {
  return new TextRun({
    text, font, rightToLeft: true,
    size: opts.size || 28,
    bold: !!opts.bold, boldComplexScript: !!opts.bold,
    color: opts.color,
  });
}
function para(children, opts = {}) {
  return new Paragraph({
    children, bidirectional: true,
    alignment: opts.alignment || AlignmentType.START,
    spacing: { after: opts.after ?? 160, line: opts.line ?? 360 },
    heading: opts.heading, indent: opts.indent,
    pageBreakBefore: opts.pageBreakBefore,
  });
}
function stripMd(s) {
  return String(s).replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/`/g, '');
}
function bodyParagraphs(text) {
  return stripMd(text).split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const bullet = /^[-•*]\s+/.test(l);
    return para([run(bullet ? '• ' + l.replace(/^[-•*]\s+/, '') : l)], {
      alignment: AlignmentType.BOTH,
      indent: bullet ? { start: 360 } : undefined,
    });
  });
}

async function exportDocx(body) {
  const title = clean(body.title, 200) || 'بحث جامعي';
  const field = clean(body.field, 100);
  const secs = (Array.isArray(body.sections) ? body.sections : []).slice(0, 20)
    .map(s => ({ title: clean(s.title, 150), body: String(s.body || '').slice(0, 30000) }))
    .filter(s => s.title);
  if (!secs.length) throw Object.assign(new Error('لا توجد أقسام للتصدير.'), { status: 400 });

  const cover = [
    para([run('')], { after: 2400 }),
    para([run(title, { size: 44, bold: true, color: '1F3864' })], { alignment: AlignmentType.CENTER, after: 400 }),
    ...(field ? [para([run(field, { size: 30 })], { alignment: AlignmentType.CENTER })] : []),
  ];
  const content = [];
  secs.forEach((s, i) => {
    content.push(para([run(s.title, { size: 34, bold: true, color: '1F3864' })], {
      heading: HeadingLevel.HEADING_1, pageBreakBefore: i === 0, after: 240,
    }));
    content.push(...bodyParagraphs(s.body));
  });

  const doc = new Document({
    title,
    styles: { default: { document: { run: { font, size: 28, rightToLeft: true } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER, bidirectional: true,
            children: [new TextRun({ children: [PageNumber.CURRENT], font })],
          })],
        }),
      },
      children: [...cover, ...content],
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------- الخادم ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(Object.assign(new Error('الطلب كبير جدًا.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON غير صالح.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (req.method === 'POST' && req.url.startsWith('/api/')) {
      const route = req.url.split('?')[0];
      const ai = route === '/api/outline' || route === '/api/section';
      if (ai && !allowed(req.socket.remoteAddress)) {
        return sendJson(res, 429, { error: 'تجاوزت الحد المسموح من الطلبات في الساعة.' });
      }
      const body = await readBody(req);
      if (route === '/api/outline') return sendJson(res, 200, await outline(body));
      if (route === '/api/section') return sendJson(res, 200, await section(body));
      if (route === '/api/export') {
        const buf = await exportDocx(body);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''research.docx",
        });
        return res.end(buf);
      }
    }
    sendJson(res, 404, { error: 'غير موجود.' });
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.status ? e.message : 'خطأ غير متوقع في الخادم.' });
    if (!e.status) console.error(e);
  }
}).listen(PORT, () => console.log(`يعمل على http://localhost:${PORT}`));
