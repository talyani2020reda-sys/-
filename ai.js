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
async function gemini(prompt, { system, schema, temp = 0.7, max = 4096, inline } = {}) {
  if (!KEY) return null;
  const body = {
    contents: [{ role: 'user', parts: [...(inline ? [{ inlineData: inline }] : []), { text: prompt }] }],
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


// ---------- لغات البحث: الفرنسية والإنجليزية (العربية هي الأصل ولم تتغير) ----------
const lg = (l) => (l === 'fr' || l === 'en' ? l : 'ar');
const SYSTEM_L = {
  ar: SYSTEM,
  fr: `Tu es un professeur universitaire algérien spécialisé dans la rédaction de recherches académiques en français.
- Style scientifique sobre, phrases claires, enchaînements logiques, formulations variées et sans remplissage.
- N'invente jamais de numéros d'articles de loi, de dates de textes, de décisions de justice, de noms d'auteurs ni de statistiques. En cas de doute, énonce le principe de façon générale sans chiffre et écris « à vérifier dans le texte législatif ».
- N'utilise pas la syntaxe Markdown (ni astérisques ni #). Sépare les paragraphes par une ligne vide et n'utilise "- " que pour les listes, si nécessaire.
- Ne répète pas le titre de la section au début, n'ajoute ni présentation de toi-même ni conclusion commentée.
- Rédige exclusivement en français.`,
  en: `You are an Algerian university professor specialised in writing academic research papers in English.
- Sober scientific style, clear sentences, logical links between ideas, varied wording and no filler.
- Never invent statute article numbers, dates of laws, court decisions, author names or statistics. If you are not sure, state the principle in general terms without a number and write "to be checked against the legislative text" where needed.
- Do not use Markdown syntax (no asterisks, no #). Separate paragraphs with a blank line and use "- " only for lists when needed.
- Do not repeat the section title at the start, and add no self-introduction or commentary at the end.
- Write exclusively in English.`,
};
const GUIDE_L = {
  ar: GUIDE,
  fr: {
    intro: "Rédige une introduction académique comprenant : une mise en contexte du sujet, son importance, la problématique formulée sous forme de question, la méthode suivie, puis l'annonce succincte du plan de la recherche.",
    conclusion: "Rédige une conclusion qui résume les principaux résultats en points clairs, puis propose des recommandations pratiques, sans introduire d'informations nouvelles.",
    chapter: "Rédige une courte introduction à cette section qui résume ce qu'elle traitera et la relie à la section précédente, sans entrer dans les détails.",
    sub: "Rédige ce paragraphe de façon détaillée et scientifique : définition ou analyse, puis fondement ou caractères, puis effet ou application selon le titre.",
    subsub: "Rédige ce point de façon ciblée et précise, en deux ou trois paragraphes.",
  },
  en: {
    intro: 'Write an academic introduction that includes: a contextual overview of the topic, its importance, the research problem stated as a question, the method followed, and a brief announcement of the research plan.',
    conclusion: 'Write a conclusion that summarises the main findings in clear points, then proposes practical recommendations, without adding new information.',
    chapter: 'Write a short opening for this section that summarises what it will cover and links it to the previous section, without going into details.',
    sub: 'Write this subsection in scientific detail: a definition or analysis, then the basis or characteristics, then the effect or application according to the title.',
    subsub: 'Write this point in a focused and precise way, in two or three paragraphs.',
  },
};
const MODES_L = {
  get ar() { return MODES; },
  fr: {
    rewrite: "Reformule le texte dans un style académique plus soutenu en conservant tous les sens et à peu près la même longueur.",
    simplify: "Simplifie et clarifie le texte avec des formulations plus faciles, sans altérer le sens ni supprimer d'idées.",
    expand: "Développe le texte avec des explications, des analyses et des exemples généraux (sans inventer de faits ni de chiffres), pour qu'il soit environ deux fois plus long.",
    shorten: "Résume le texte en environ la moitié de sa longueur en gardant les idées essentielles.",
    proofread: "Corrige le texte (langue, grammaire, orthographe, ponctuation) uniquement, sans changer le style ni le sens.",
    custom: "Modifie le texte selon les consignes de l'étudiant.",
  },
  en: {
    rewrite: 'Rewrite the text in a more polished academic style, keeping every meaning and roughly the same length.',
    simplify: 'Simplify and clarify the text with easier wording, without changing the meaning or dropping any idea.',
    expand: 'Expand the text with explanation, analysis and general examples (without inventing facts or numbers), making it about twice as long.',
    shorten: 'Summarise the text to about half its length while keeping the essential ideas.',
    proofread: 'Proofread the text for language, grammar, spelling and punctuation only, without changing the style or the meaning.',
    custom: "Edit the text according to the student's instructions.",
  },
};
const UNITS = {
  ar: { mabhath: ['المباحث', 'المطالب'], fasl: ['الفصول', 'المباحث'] },
  fr: { mabhath: ['sections', 'paragraphes'], fasl: ['chapitres', 'sections'] },
  en: { mabhath: ['sections', 'subsections'], fasl: ['chapters', 'sections'] },
};

const schemaPlan = (d) => {
  const leaf = { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] };
  const sub = { type: 'OBJECT', properties: { title: { type: 'STRING' }, subs: { type: 'ARRAY', items: leaf } }, required: ['title', 'subs'] };
  return { type: 'OBJECT', properties: { chapters: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, subs: { type: 'ARRAY', items: sub } }, required: ['title', 'subs'] } } }, required: ['chapters'] };
};

function clean(t) {
  return String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/^\s*\*\s+/gm, '- ').replace(/`/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function plan({ title, field, chapters = 2, depth = 2, system = 'mabhath', lang }) {
  const L = lg(lang);
  const n = Math.min(Math.max(+chapters || 2, 1), 5); const d = depth === 3 ? 3 : 2;
  const unit = UNITS[L][system === 'fasl' ? 'fasl' : 'mabhath'];
  const prompts = {
    ar: `ضع خطة بحث جامعي لموضوع: «${title}»${field ? ` في مقياس/تخصص: ${field}` : ''}.
المطلوب: ${n} من ${unit[0]}، وفي كل واحد منها مطلبان متكاملان (من ${unit[1]})${d === 3 ? '، ولكل مطلب فرعان' : ' ولا تضع فروعًا (اجعل subs مصفوفة فارغة)'}.
- العناوين محددة وقصيرة ومتدرجة منطقيًا من العام إلى الخاص، وتغطي الموضوع دون تكرار.
- لا تكتب كلمات الترقيم مثل «المبحث الأول».
- ${n > 1 ? 'اجعل المبحث الأول للإطار المفاهيمي أو النظري، وما بعده للأحكام والآثار والتطبيق.' : ''}`,
    fr: `Établis le plan d'une recherche universitaire sur le sujet : « ${title} »${field ? ` dans la matière ou la spécialité : ${field}` : ''}.
Attendu : ${n} ${unit[0]}, chacun comportant deux éléments complémentaires (des ${unit[1]})${d === 3 ? ', et chaque élément comportant deux sous-points' : ' et aucun sous-point (subs doit être un tableau vide)'}.
- Titres précis et courts, progressant logiquement du général au particulier, couvrant le sujet sans répétition.
- N'écris pas les mots de numérotation comme « Section 1 ».
- ${n > 1 ? "Consacre le premier élément au cadre conceptuel ou théorique, et les suivants au régime, aux effets et à l'application." : ''}
- Rédige tous les titres en français.`,
    en: `Draw up the plan of a university research paper on the topic: "${title}"${field ? ` in the subject or specialty: ${field}` : ''}.
Required: ${n} ${unit[0]}, each containing two complementary items (${unit[1]})${d === 3 ? ', and each item containing two sub-points' : ' and no sub-points (subs must be an empty array)'}.
- Titles are precise and short, moving logically from the general to the particular, covering the topic without repetition.
- Do not write numbering words such as "Section 1".
- ${n > 1 ? 'Make the first item the conceptual or theoretical framework, and the following ones the rules, effects and application.' : ''}
- Write every title in English.`,
  };
  const t = await gemini(prompts[L], { system: SYSTEM_L[L], schema: schemaPlan(d), temp: 0.5 });
  if (!t) return null;
  const parsed = JSON.parse(t.replace(/^```json|```$/g, ''));
  return { chapters: (parsed.chapters || []).map((c) => ({ title: clean(c.title), subs: (c.subs || []).map((s) => ({ title: clean(s.title), subs: d === 3 ? (s.subs || []).map((x) => ({ title: clean(x.title) })) : [] })) })) };
}

async function write({ title, heading, parents, words = 220, instruction = '', type = 'sub', outline = '', prev = '', field = '', lang }) {
  const L = lg(lang);
  const w = Math.min(Math.max(+words || 220, 60), 700);
  const guide = GUIDE_L[L][type] || GUIDE_L[L].sub;
  const prompts = {
    ar: `موضوع البحث: «${title}»${field ? ` — المقياس: ${field}` : ''}.
${outline ? `خطة البحث كاملة (للاتساق وعدم التكرار):\n${outline}\n` : ''}${parents ? `موقع العنوان في الخطة: ${parents}.\n` : ''}${prev ? `آخر نص كُتب قبل هذا القسم (لا تكرّر أفكاره، واربط به بسلاسة):\n«${String(prev).slice(-700)}»\n` : ''}
العنوان المطلوب كتابته: «${heading}».
${guide}
الطول: نحو ${w} كلمة.${instruction ? `\nتعليمات إضافية من الطالب: ${instruction}` : ''}`,
    fr: `Sujet de la recherche : « ${title} »${field ? ` — Matière : ${field}` : ''}.
${outline ? `Plan complet de la recherche (pour la cohérence et pour éviter les répétitions) :\n${outline}\n` : ''}${parents ? `Position du titre dans le plan : ${parents}.\n` : ''}${prev ? `Dernier texte rédigé avant cette section (ne répète pas ses idées, enchaîne avec fluidité) :\n« ${String(prev).slice(-700)} »\n` : ''}
Titre à rédiger : « ${heading} ».
${guide}
Longueur : environ ${w} mots.${instruction ? `\nConsignes supplémentaires de l'étudiant : ${instruction}` : ''}
Rédige en français.`,
    en: `Research topic: "${title}"${field ? ` — Subject: ${field}` : ''}.
${outline ? `Full research plan (for consistency and to avoid repetition):\n${outline}\n` : ''}${parents ? `Position of the heading in the plan: ${parents}.\n` : ''}${prev ? `Last text written before this section (do not repeat its ideas, and link to it smoothly):\n"${String(prev).slice(-700)}"\n` : ''}
Heading to write: "${heading}".
${guide}
Length: about ${w} words.${instruction ? `\nExtra instructions from the student: ${instruction}` : ''}
Write in English.`,
  };
  const t = await gemini(prompts[L], { system: SYSTEM_L[L], temp: 0.75, max: Math.max(1024, w * (L === 'ar' ? 6 : 8)) });
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
async function rewrite({ text, mode, instruction, lang }) {
  const L = lg(lang); const M = MODES_L[L];
  const prompts = {
    ar: `${M[mode] || M.custom}${instruction ? `\nتعليمات الطالب: ${instruction}` : ''}
أعد النص المعدَّل وحده دون أي تعليق أو شرح.

النص:
${text}`,
    fr: `${M[mode] || M.custom}${instruction ? `\nConsignes de l'étudiant : ${instruction}` : ''}
Renvoie uniquement le texte modifié, sans commentaire ni explication, et en français.

Texte :
${text}`,
    en: `${M[mode] || M.custom}${instruction ? `\nStudent's instructions: ${instruction}` : ''}
Return only the edited text, with no comment or explanation, and in English.

Text:
${text}`,
  };
  const t = await gemini(prompts[L], { system: SYSTEM_L[L], temp: mode === 'proofread' ? 0.2 : 0.6, max: 4096 });
  return t ? clean(t) : null;
}

// ---------- تلخيص المحاضرات + مخطط هرمي ----------
const SUM_SYSTEM = `أنت أستاذ جامعي جزائري يلخّص المحاضرات للطلبة بالعربية الفصحى.
- التزم بمضمون المحاضرة فقط، ولا تضف معلومات من خارجها، ولا تختلق أرقام مواد أو تواريخ أو أحكامًا أو أسماء.
- احتفظ بالمصطلحات القانونية كما وردت في النص.
- لا تستعمل رموز Markdown. اجعل العناوين قصيرة (حتى 8 كلمات) والتفاصيل عبارات موجزة (حتى 14 كلمة).`;

const schemaSummary = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    branches: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      title: { type: 'STRING' },
      points: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, details: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['title', 'details'] } },
    }, required: ['title', 'points'] } },
  },
  required: ['title', 'summary', 'branches'],
};

const SUM_DETAIL = {
  short: { branches: '3 إلى 4', points: '2 إلى 3', details: 'من صفر إلى تفصيلين', words: '80 إلى 120' },
  normal: { branches: '4 إلى 5', points: '2 إلى 4', details: 'من تفصيل إلى تفصيلين', words: '140 إلى 200' },
  detailed: { branches: '5 إلى 7', points: '3 إلى 5', details: 'من تفصيلين إلى ثلاثة', words: '220 إلى 320' },
};

async function summarize({ text = '', file, detail = 'normal' }) {
  const d = SUM_DETAIL[detail] || SUM_DETAIL.normal;
  const body = String(text || '').slice(0, 30000);
  const prompt = `${file ? 'المحاضرة مرفقة كملف' + (body ? '، وهذه ملاحظات إضافية من الطالب:' : '.') : 'نص المحاضرة:'}
${body}

المطلوب (JSON):
- title: عنوان المحاضرة (جذر المخطط).
- summary: ملخص متماسك في فقرات قصيرة بنحو ${d.words} كلمة.
- branches: المحاور الكبرى للمحاضرة، عددها ${d.branches}، مرتّبة كما وردت. لكل محور points بعددها ${d.points}، ولكل نقطة details (${d.details}) تضم تعريفًا أو شرطًا أو أثرًا أو مثالًا مذكورًا في المحاضرة.
- المخطط هرمي: العنوان ← المحاور ← النقاط ← التفاصيل، دون تكرار بين المحاور.`;
  const inline = file && file.data && file.mime ? { mimeType: file.mime, data: file.data } : undefined;
  const t = await gemini(prompt, { system: SUM_SYSTEM, schema: schemaSummary, temp: 0.3, max: 8192, inline });
  if (!t) return null;
  let p; try { p = JSON.parse(t.replace(/^```json|```$/g, '')); } catch (e) { throw new Error('تعذّر تنظيم الملخص. أعد المحاولة.'); }
  const arr = (a) => (Array.isArray(a) ? a : []);
  return {
    title: clean(p.title),
    summary: clean(p.summary),
    branches: arr(p.branches).map((b) => ({ title: clean(b.title), points: arr(b.points).map((x) => ({ title: clean(x.title), details: arr(x.details).map(clean).filter(Boolean) })).filter((x) => x.title) })).filter((b) => b.title),
  };
}

// ---------- حماية الحصة: حدّ للطلبات لكل زائر ----------
const hits = new Map();
function limited(ip, max = +process.env.AI_LIMIT || 60, windowMs = 10 * 60 * 1000) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k); }, 600000).unref();

module.exports = { enabled: !!KEY, models: MODELS, plan, write, rewrite, summarize, limited };
