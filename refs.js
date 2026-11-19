// البحث عن مراجع حقيقية من قواعد بيانات مفتوحة (لا يُختلق أي مرجع)
// المصادر: OpenAlex (مقالات وكتب) · Crossref (مقالات بمعرّف DOI) · Google Books (كتب)
const T = 9000;
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(T), headers: { 'User-Agent': 'Rida-Platform-Expose/1.0 (mailto:contact@example.com)' } });
  if (!r.ok) throw new Error(url.split('/')[2] + ' ' + r.status);
  return r.json();
};
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function openalex(q, n) {
  const j = await get(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${n}&select=id,doi,title,display_name,publication_year,type,authorships,primary_location`);
  return (j.results || []).map((w) => ({
    source: 'OpenAlex', title: strip(w.display_name || w.title), year: w.publication_year || '',
    authors: (w.authorships || []).slice(0, 4).map((a) => a.author && a.author.display_name).filter(Boolean),
    venue: strip(w.primary_location && w.primary_location.source && w.primary_location.source.display_name),
    kind: w.type === 'book' || w.type === 'book-chapter' ? 'كتاب' : 'مقال',
    url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || w.id,
  }));
}
async function crossref(q, n) {
  const j = await get(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${n}&select=title,author,issued,container-title,publisher,DOI,type`);
  return ((j.message && j.message.items) || []).map((w) => ({
    source: 'Crossref', title: strip((w.title || [])[0]), year: (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0] && w.issued['date-parts'][0][0]) || '',
    authors: (w.author || []).slice(0, 4).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean),
    venue: strip((w['container-title'] || [])[0] || w.publisher),
    kind: /book/.test(w.type || '') ? 'كتاب' : 'مقال', url: w.DOI ? 'https://doi.org/' + w.DOI : '',
  }));
}
async function gbooks(q, n) {
  const j = await get(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${n}&printType=books`);
  return (j.items || []).map((b) => { const v = b.volumeInfo || {}; return {
    source: 'Google Books', title: strip([v.title, v.subtitle].filter(Boolean).join(': ')), year: (v.publishedDate || '').slice(0, 4),
    authors: (v.authors || []).slice(0, 4), venue: strip(v.publisher), kind: 'كتاب', url: v.infoLink || v.previewLink || '',
  }; });
}

const norm = (s) => String(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function searchRefs(q, { limit = 8 } = {}) {
  q = String(q || '').trim().slice(0, 200);
  if (q.length < 3) return { items: [], errors: [] };
  const jobs = [['OpenAlex', openalex], ['Crossref', crossref], ['Google Books', gbooks]];
  const res = await Promise.allSettled(jobs.map(([, f]) => f(q, limit)));
  const errors = []; const lists = [];
  res.forEach((r, i) => (r.status === 'fulfilled' ? lists.push(r.value) : errors.push(jobs[i][0])));
  // دمج بالتناوب بين المصادر مع حذف التكرار
  const seen = new Set(); const items = [];
  for (let k = 0; k < limit; k++) lists.forEach((l) => {
    const it = l[k]; if (!it || !it.title) return;
    const key = norm(it.title).slice(0, 60); if (seen.has(key)) return; seen.add(key); items.push(it);
  });
  items.forEach((it) => { it.citation = cite(it); });
  return { items, errors };
}

// صيغة الإحالة: المؤلف، العنوان، الناشر/المجلة، السنة.
function cite(it) {
  const parts = [(it.authors || []).join('، '), it.title, it.venue, it.year].filter(Boolean);
  return parts.join('، ') + '.' + (it.url ? ' ' + it.url : '');
}

module.exports = { searchRefs, cite };
