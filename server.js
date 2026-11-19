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
const ORD = ['الأول', 'الثاني'];

// يحوّل الخطة الثنائية (مبحثان، لكل مبحث مطلبان، ولكل مطلب فرعان) إلى قائمة مسطّحة مرتّبة
function buildBinary(p) {
  const mabahith = (Array.isArray(p.mabahith) ? p.mabahith : []).slice(0, 2);
  if (mabahith.length < 2) return null;
  const out = [{ kind: 'intro', label: '', title: 'مقدمة', summary: clean(p.introduction, 300) }];
  for (let i = 0; i < 2; i++) {
    const m = mabahith[i] || {};
    const matalib = (Array.isArray(m.matalib) ? m.matalib : []).slice(0, 2);
    if (!clean(m.title, 150) || matalib.length < 2) return null;
    out.push({ kind: 'mabhath', label: `المبحث ${ORD[i]}`, title: clean(m.title, 150), summary: clean(m.summary, 300) });
    for (let j = 0; j < 2; j++) {
      const t = matalib[j] || {};
      const furu = (Array.isArray(t.furu) ? t.furu : []).slice(0, 2);
      if (!clean(t.title, 150) || furu.length < 2) return null;
      out.push({ kind: 'matlab', label: `المطلب ${ORD[j]}`, title: clean(t.title, 150), summary: '' });
      for (let k = 0; k < 2; k++) {
        const f = furu[k] || {};
        if (!clean(f.title, 150)) return null;
        out.push({ kind: 'far3', label: `الفرع ${ORD[k]}`, title: clean(f.title, 150), summary: clean(f.summary, 300) });
      }
    }
  }
  out.push({ kind: 'conclusion', label: '', title: 'خاتمة', summary: clean(p.conclusion, 300) });
  return out;
}

function parseJson(raw) {
  try { return JSON.parse(raw.replace(/^```json|```$/g, '').trim()); }
  catch { throw Object.assign(new Error('تعذّر فهم خطة البحث، أعد المحاولة.'), { status: 502 }); }
}

async function outline(body) {
  const title = clean(body.title, 200);
  const field = clean(body.field, 100) || 'العلوم الجامعية';
  const pages = clamp(parseInt(body.pages, 10) || 10, 4, 60);
  const plan = body.plan === 'flat' ? 'flat' : 'binary';
  if (!title) throw Object.assign(new Error('أدخل عنوان البحث.'), { status: 400 });

  if (plan === 'binary') {
    const prompt = `أنت أستاذ جامعي متخصص في ${field}. ضع خطة بحث جامعي ثنائية (الخطة الثنائية المعتمدة في الجامعات الجزائرية) بعنوان: "${title}".
عدد الصفحات المطلوب تقريبًا: ${pages}.
هيكل الخطة: مقدمة، ثم مبحثان، لكل مبحث مطلبان، ولكل مطلب فرعان، ثم خاتمة.
أعد JSON فقط بهذا الشكل بالضبط:
{"introduction":"جملة عن محتوى المقدمة","mabahith":[{"title":"...","summary":"جملة واحدة","matalib":[{"title":"...","furu":[{"title":"...","summary":"جملة واحدة"},{"title":"...","summary":"جملة واحدة"}]},{"title":"...","furu":[{"title":"...","summary":"..."},{"title":"...","summary":"..."}]}]},{"title":"...","summary":"...","matalib":[...]}],"conclusion":"جملة عن محتوى الخاتمة"}
الشروط: مبحثان بالضبط، ولكل مبحث مطلبان بالضبط، ولكل مطلب فرعان بالضبط؛ عناوين عربية واضحة ومترابطة منطقيًا، والمبحث الثاني يكمّل الأول؛ بلا ترقيم ولا كلمات «المبحث» أو «المطلب» أو «الفرع» داخل العناوين.`;
    const sections = buildBinary(parseJson(await callGemini(prompt, { json: true })));
    if (!sections) throw Object.assign(new Error('خطة غير مكتملة، أعد المحاولة.'), { status: 502 });
    return { sections };
  }

  const n = clamp(Math.round(pages / 4), 2, 8);
  const prompt = `أنت أستاذ جامعي متخصص في ${field}. ضع خطة بحث جامعي بعنوان: "${title}".
عدد الصفحات المطلوب تقريبًا: ${pages}.
أعد JSON فقط بهذا الشكل: {"sections":[{"title":"...","summary":"جملة واحدة عن محتوى القسم"}]}
الشروط: تبدأ الخطة بـ "مقدمة" وتنتهي بـ "خاتمة"، وبينهما ${n} مباحث مرتبة منطقيًا، بعناوين عربية واضحة بلا ترقيم.`;
  const parsed = parseJson(await callGemini(prompt, { json: true }));
  const sections = (parsed.sections || [])
    .map(s => ({ kind: 'section', label: '', title: clean(s.title, 150), summary: clean(s.summary, 300) }))
    .filter(s => s.title).slice(0, 14);
  if (sections.length < 3) throw Object.assign(new Error('خطة غير مكتملة، أعد المحاولة.'), { status: 502 });
  return { sections };
}

async function section(body) {
  const title = clean(body.title, 200);
  const field = clean(body.field, 100) || 'العلوم الجامعية';
  const pages = clamp(parseInt(body.pages, 10) || 10, 4, 60);
  const sec = body.section || {};
  const secTitle = clean(sec.title, 150);
  const label = clean(sec.label, 40);
  const kind = ['intro', 'conclusion', 'far3'].includes(sec.kind) ? sec.kind : 'section';
  const parents = (Array.isArray(sec.parents) ? sec.parents : []).map(p => clean(p, 200)).filter(Boolean).slice(0, 2);
  const titles = (Array.isArray(body.outline) ? body.outline : []).map(t => clean(t, 200)).slice(0, 30);
  if (!title || !secTitle) throw Object.assign(new Error('بيانات ناقصة.'), { status: 400 });
  const units = clamp(parseInt(body.units, 10) || titles.length, 1, 30);
  const words = clamp(Math.round((pages * 250) / Math.max(units, 3)), 150, 900);
  const heading = label ? `${label}: ${secTitle}` : secTitle;
  const where = parents.length ? `\nموقعه في الخطة: ${parents.join(' ← ')}` : '';
  const extra = kind === 'intro'
    ? '\nتتضمن المقدمة: تمهيدًا للموضوع، وأهميته، وإشكالية البحث، والمنهج المتبع، ثم الإعلان عن خطة البحث.'
    : kind === 'conclusion'
      ? '\nتتضمن الخاتمة: خلاصة ما توصل إليه البحث، ثم أبرز النتائج والتوصيات.'
      : '';
  const prompt = `اكتب قسم "${heading}" من بحث جامعي بعنوان "${title}" في تخصص ${field}.
خطة البحث الكاملة: ${titles.join(' | ')}${where}
ملخص هذا القسم: ${clean(sec.summary, 300)}${extra}
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
  const KINDS = ['section', 'intro', 'conclusion', 'mabhath', 'matlab', 'far3'];
  const secs = (Array.isArray(body.sections) ? body.sections : []).slice(0, 40)
    .map(s => ({
      title: clean(s.title, 150), label: clean(s.label, 40),
      kind: KINDS.includes(s.kind) ? s.kind : 'section',
      body: String(s.body || '').slice(0, 30000),
    }))
    .filter(s => s.title);
  if (!secs.length) throw Object.assign(new Error('لا توجد أقسام للتصدير.'), { status: 400 });

  const univ = clean(body.university, 120);
  const faculty = clean(body.faculty, 120), dept = clean(body.department, 120);
  const student = clean(body.student, 100), supervisor = clean(body.supervisor, 100), year = clean(body.year, 30);
  const centered = (text, o = {}) => para([run(text, { size: o.size || 28, bold: !!o.bold, color: o.color })], {
    alignment: AlignmentType.CENTER, after: o.after ?? 120,
  });
  const prefixed = (word, v) => (v.startsWith(word) ? v : `${word} ${v}`);
  const cover = [
    ...(univ ? [
      centered('الجمهورية الجزائرية الديمقراطية الشعبية', { bold: true }),
      centered('وزارة التعليم العالي والبحث العلمي', { bold: true, after: 240 }),
      centered(univ, { bold: true, size: 30 }),
      ...(faculty ? [centered(prefixed('كلية', faculty))] : []),
      ...(dept ? [centered(prefixed('قسم', dept))] : []),
    ] : []),
    para([run('')], { after: univ ? 1600 : 2400 }),
    centered(title, { size: 44, bold: true, color: '1F3864', after: 400 }),
    ...(field ? [centered(field, { size: 30, after: 1600 })] : []),
    ...(student ? [centered(`من إعداد الطالب: ${student}`, { after: 160 })] : []),
    ...(supervisor ? [centered(`تحت إشراف: ${supervisor}`, { after: 160 })] : []),
    ...(year ? [centered(`السنة الجامعية: ${year}`, { after: 160 })] : []),
  ];
  const content = [];
  const LEVEL = {
    mabhath: [HeadingLevel.HEADING_1, 34],
    matlab: [HeadingLevel.HEADING_2, 30],
    far3: [HeadingLevel.HEADING_3, 28],
  };
  secs.forEach((s, i) => {
    const [heading, size] = LEVEL[s.kind] || [HeadingLevel.HEADING_1, 34];
    const text = s.label ? `${s.label}: ${s.title}` : s.title;
    content.push(para([run(text, { size, bold: true, color: '1F3864' })], {
      heading, after: s.kind === 'far3' ? 160 : 240,
      pageBreakBefore: i === 0 || s.kind === 'mabhath' || s.kind === 'conclusion',
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
