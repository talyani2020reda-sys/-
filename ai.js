// خدمة Gemini: طلبات متينة (إعادة محاولة + نماذج بديلة) وتعليمات أكاديمية وسياق بين الأقسام
const KEY = process.env.GEMINI_API_KEY || '';
const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function call(model, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new AiError(t.slice(0, 300), r.status); }
  const j = await r.json();
  const cand = j.candidates && j.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new AiError(cand && cand.finishReason ? 'finish:' + cand.finishReason : 'empty', 422);
  return text;
}

// system: تعليمات النظام · json: مخطط JSON اختياري · temp: حرارة التوليد
async function gemini(prompt, { system, schema, temp = 0.7, max = 4096 } = {}) {
  if (!KEY) return null;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: temp, maxOutputTokens: max, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  let last;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await call(model, body); }
      catch (e) {
        last = e;
        if (e.status === 429 || e.status >= 500) { await sleep(900 * (attempt + 1) * (attempt + 1)); if (e.status === 429 && attempt >= 1) break; continue; }
        if (e.status === 404 || e.status === 400) break; // نموذج غير متاح: جرّب التالي
        if (e.status === 422) continue;
        throw friendly(e);
      }
    }
  }
  throw friendly(last);
}

function friendly(e) {
  if (!e) return new Error('تعذّر الاتصال بالذكاء الاصطناعي.');
  if (e.status === 429) return new Error('انتهت حصة Gemini المجانية مؤقتًا. انتظر دقيقة ثم أعد المحاولة.');
  if (e.status === 401 || e.status === 403) return new Error('مفتاح Gemini غير صالح أو غير مفعّل. تحقق من GEMINI_API_KEY.');
  if (e.status === 422) return new Error('لم يُنتج الذكاء الاصطناعي نصًّا لهذا القسم. أعد المحاولة أو غيّر العنوان.');
  return new Error('تعذّر الاتصال بالذكاء الاصطناعي الآن. أعد المحاولة.');
}

// ---------- التعليمات ----------
const SYSTEM = `أنت أستاذ جامعي جزائري متخصص في كتابة البحوث الأكاديمية بالعربية الفصحى.
- أسلوب علمي رصين، جمل واضحة، ربط منطقي بين الأفكار، وتنوّع في الصياغة دون حشو.
- لا تختلق أرقام مواد قانونية أو تواريخ قوانين أو أحكامًا قضائية أو أسماء مؤلفين أو إحصائيات. إن لم تكن متأكدًا فاذكر المبدأ عامًّا دون رقم، واكتب «يُراجع النص التشريعي» عند الحاجة.
- لا تستعمل رموز Markdown (لا نجوم ولا #). افصل الفقرات بسطر فارغ، واستعمل "- " فقط للقوائم عند الحاجة.
- لا تكرّر عنوان القسم في بدايته، ولا تضف مقدمة عن نفسك ولا خاتمة تعليقية.`;

const GUIDE = {
  intro: 'اكتب مقدمة بحث أكاديمية تتضمن: تمهيدًا للموضوع، أهميته، إشكالية البحث بصيغة سؤال، المنهج المتبع، ثم الإعلان عن خطة البحث باختصار.',
  conclusion: 'اكتب خاتمة تلخّص أهم النتائج المتوصَّل إليها في نقاط واضحة، ثم تقترح توصيات عملية، دون إضافة معلومات جديدة.',
  chapter: 'اكتب تمهيدًا قصيرًا لهذا المبحث يُجمل ما سيعالجه ويربطه بالمبحث السابق دون الدخول في التفاصيل.',
  sub: 'اكتب هذا المطلب بتفصيل علمي: تعريف أو تحليل، ثم الأساس أو الخصائص، ثم الأثر أو التطبيق بحسب العنوان.',
  subsub: 'اكتب هذا الفرع مركّزًا ومحدّدًا في نقطته، بفقرتين أو ثلاث.',
};

const schemaPlan = (d) => {
  const leaf = { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] };
  const sub = { type: 'OBJECT', properties: { title: { type: 'STRING' }, subs: { type: 'ARRAY', items: leaf } }, required: ['title', 'subs'] };
  return { type: 'OBJECT', properties: { chapters: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, subs: { type: 'ARRAY', items: sub } }, required: ['title', 'subs'] } } }, required: ['chapters'] };
};

function clean(t) {
  return String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/^\s*\*\s+/gm, '- ').replace(/`/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function plan({ title, field, chapters = 2, depth = 2, system = 'mabhath' }) {
  const n = Math.min(Math.max(+chapters || 2, 1), 5); const d = depth === 3 ? 3 : 2;
  const unit = system === 'fasl' ? ['الفصول', 'المباحث'] : ['المباحث', 'المطالب'];
  const prompt = `ضع خطة بحث جامعي لموضوع: «${title}»${field ? ` في مقياس/تخصص: ${field}` : ''}.
المطلوب: ${n} من ${unit[0]}، وفي كل واحد منها مطلبان متكاملان (من ${unit[1]})${d === 3 ? '، ولكل مطلب فرعان' : ' ولا تضع فروعًا (اجعل subs مصفوفة فارغة)'}.
- العناوين محددة وقصيرة ومتدرجة منطقيًا من العام إلى الخاص، وتغطي الموضوع دون تكرار.
- لا تكتب كلمات الترقيم مثل «المبحث الأول».
- ${n > 1 ? 'اجعل المبحث الأول للإطار المفاهيمي أو النظري، وما بعده للأحكام والآثار والتطبيق.' : ''}`;
  const t = await gemini(prompt, { system: SYSTEM, schema: schemaPlan(d), temp: 0.5 });
  if (!t) return null;
  const parsed = JSON.parse(t.replace(/^```json|```$/g, ''));
  return { chapters: (parsed.chapters || []).map((c) => ({ title: clean(c.title), subs: (c.subs || []).map((s) => ({ title: clean(s.title), subs: d === 3 ? (s.subs || []).map((x) => ({ title: clean(x.title) })) : [] })) })) };
}

async function write({ title, heading, parents, words = 220, instruction = '', type = 'sub', outline = '', prev = '', field = '' }) {
  const w = Math.min(Math.max(+words || 220, 60), 700);
  const prompt = `موضوع البحث: «${title}»${field ? ` — المقياس: ${field}` : ''}.
${outline ? `خطة البحث كاملة (للاتساق وعدم التكرار):\n${outline}\n` : ''}${parents ? `موقع العنوان في الخطة: ${parents}.\n` : ''}${prev ? `آخر نص كُتب قبل هذا القسم (لا تكرّر أفكاره، واربط به بسلاسة):\n«${String(prev).slice(-700)}»\n` : ''}
العنوان المطلوب كتابته: «${heading}».
${GUIDE[type] || GUIDE.sub}
الطول: نحو ${w} كلمة.${instruction ? `\nتعليمات إضافية من الطالب: ${instruction}` : ''}`;
  const t = await gemini(prompt, { system: SYSTEM, temp: 0.75, max: Math.max(1024, w * 6) });
  return t ? clean(t) : null;
}

const MODES = {
  rewrite: 'أعد صياغة النص بأسلوب أكاديمي أرقى مع الحفاظ على كل المعاني وبالطول نفسه تقريبًا.',
  simplify: 'بسّط النص وأوضحه بعبارات أسهل دون الإخلال بالمعنى ودون حذف الأفكار.',
  expand: 'وسّع النص بشرح وتحليل وأمثلة عامة (دون اختلاق وقائع أو أرقام)، ليصبح أطول بنحو الضعف.',
  shorten: 'لخّص النص في نحو نصف طوله مع إبقاء الأفكار الأساسية.',
  proofread: 'دقّق النص لغويًا ونحويًا وإملائيًا وصحّح علامات الترقيم فقط، دون تغيير الأسلوب أو المعنى.',
  custom: 'عدّل النص وفق تعليمات الطالب.',
};
async function rewrite({ text, mode, instruction }) {
  const prompt = `${MODES[mode] || MODES.custom}${instruction ? `\nتعليمات الطالب: ${instruction}` : ''}
أعد النص المعدَّل وحده دون أي تعليق أو شرح.

النص:
${text}`;
  const t = await gemini(prompt, { system: SYSTEM, temp: mode === 'proofread' ? 0.2 : 0.6, max: 4096 });
  return t ? clean(t) : null;
}

// ---------- حماية الحصة: حدّ للطلبات لكل زائر ----------
const hits = new Map();
function limited(ip, max = +process.env.AI_LIMIT || 60, windowMs = 10 * 60 * 1000) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k); }, 600000).unref();

module.exports = { enabled: !!KEY, models: MODELS, plan, write, rewrite, limited };
