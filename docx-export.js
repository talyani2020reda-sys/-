// تصدير البحث إلى Word (RTL) مع غلاف مزخرف وتأطير للصفحات وفهرس وترقيم
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ImageRun, Footer, Header, PageNumber, TableOfContents, ShadingType, TableLayoutType,
  PageBorderDisplay, PageBorderOffsetFrom, PageBorderZOrder, LevelFormat, VerticalAlign,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, HeightRule, LineRuleType,
} = require('docx');
const { ornament, W: OW, H: OH } = require('./ornament');
const fs = require('fs');
const path = require('path');

const FRAMES = {
  none: null,
  simple: { style: BorderStyle.SINGLE, size: 8 },
  double: { style: BorderStyle.DOUBLE, size: 6 },
  classic: { style: BorderStyle.THICK_THIN_LARGE_GAP, size: 18 },
  triple: { style: BorderStyle.TRIPLE, size: 10 },
};

const hex = (c, d) => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '') : d);
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

async function buildDocx(data) {
  const meta = data.meta || {};
  const opt = data.options || {};
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const refs = (data.references || []).map(clean).filter(Boolean);

  // لغة البحث: العربية (RTL) أو الفرنسية/الإنجليزية (LTR). النصوص الثابتة تأتي من الواجهة (opt.strings)
  const LANG = opt.lang === 'fr' || opt.lang === 'en' ? opt.lang : 'ar';
  const RTL = LANG === 'ar';
  const STR = opt.strings || {};
  const S = (k, dflt) => (RTL ? dflt : (STR[k] || dflt));
  const FONT = RTL ? (opt.font || 'Traditional Arabic') : (opt.font === 'Arial' ? 'Arial' : 'Times New Roman');
  const PT = Math.min(Math.max(Number(opt.fontSize) || 16, 12), 20);
  const SZ = PT * 2;
  const LINE = Math.round((Number(opt.lineSpacing) || 1.5) * 240);
  const NAVY = hex(opt.color, '1B2A4A');
  const GOLD = 'B8923A';
  const frame = FRAMES[opt.frame] ? opt.frame : 'none';
  const font = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };

  const run = (text, o = {}) => new TextRun({
    text: clean(text), font, rightToLeft: RTL,
    size: o.size || SZ, sizeComplexScript: o.size || SZ,
    bold: !!o.bold, boldComplexScript: !!o.bold,
    color: o.color, italics: false,
  });

  const para = (children, o = {}) => new Paragraph({
    bidirectional: RTL,
    alignment: o.align || AlignmentType.START,
    spacing: { line: o.line || LINE, before: o.before || 0, after: o.after == null ? 120 : o.after },
    ...(o.rest || {}),
    children,
  });

  // تأطير نص العنوان: فقرات متجاورة بحدود متطابقة تندمج في إطار واحد في Word
  const TF = opt.textFrame || {};
  const TFSTYLE = ['box', 'double', 'shaded', 'dashed'].includes(TF.style) ? TF.style : null;
  const TFSCOPE = TF.scope || {};
  const isFramed = (n) => !!TFSTYLE && n.body && (
    (n.type === 'chapter' && TFSCOPE.chapter) || (n.type === 'sub' && TFSCOPE.sub) ||
    (n.type === 'subsub' && TFSCOPE.subsub) || ((n.type === 'intro' || n.type === 'conclusion' || n.type === 'free') && TFSCOPE.intro));
  const frameBorder = () => {
    const st = TFSTYLE === 'double' ? BorderStyle.DOUBLE : TFSTYLE === 'dashed' ? BorderStyle.DASHED : BorderStyle.SINGLE;
    const sz = TFSTYLE === 'double' ? 6 : TFSTYLE === 'shaded' ? 4 : 8;
    const col = TFSTYLE === 'shaded' ? 'C9CCD6' : TFSTYLE === 'dashed' ? GOLD : NAVY;
    const b = { style: st, size: sz, color: col, space: 8 };
    return { top: b, bottom: b, left: b, right: b };
  };

  const bodyParas = (text, framed) => {
    const out = [];
    const lines = clean(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((l) => {
      const isBul = /^[-•*]\s+/.test(l);
      if (framed) {
        const txt = l.replace(/^[-•*]\s+/, '');
        out.push(new Paragraph({
          bidirectional: RTL, alignment: AlignmentType.BOTH,
          border: frameBorder(), indent: { left: 160, right: 160 },
          ...(TFSTYLE === 'shaded' ? { shading: { type: ShadingType.CLEAR, fill: 'F7F8FB', color: 'auto' } } : {}),
          spacing: { line: LINE, after: 60 },
          children: isBul ? [run('◆  ', { color: GOLD, size: SZ - 6 }), run(txt)] : [run(txt)],
        }));
      } else if (isBul) {
        out.push(new Paragraph({
          bidirectional: RTL, alignment: AlignmentType.BOTH,
          numbering: { reference: 'bul', level: 0 },
          spacing: { line: LINE, after: 60 },
          children: [run(l.replace(/^[-•*]\s+/, ''))],
        }));
      } else {
        out.push(para([run(l)], { align: AlignmentType.BOTH, rest: { indent: { firstLine: 567 } } }));
      }
    });
    if (framed && out.length) out.push(new Paragraph({ spacing: { after: 160, line: 120 }, children: [] }));
    return out;
  };

  // ---------- أنماط العناوين (تُستعمل أيضًا في الفهرس) ----------
  const hStyle = (id, name, size, o = {}) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font, size, sizeComplexScript: size, bold: true, boldComplexScript: true, color: o.color || NAVY, rightToLeft: RTL },
    paragraph: {
      bidirectional: RTL, alignment: o.align || AlignmentType.START, keepNext: true,
      spacing: { before: o.before, after: o.after, line: 300 }, outlineLevel: o.lvl,
      ...(o.paragraph || {}),
    },
  });
  const tocStyle = (id, name, left) => ({
    id, name, basedOn: 'Normal', next: 'Normal',
    run: { font, size: SZ, sizeComplexScript: SZ, rightToLeft: RTL },
    paragraph: { bidirectional: RTL, indent: { left }, spacing: { line: 300, after: 80 } },
  });

  const styles = {
    default: { document: { run: { font, size: SZ, sizeComplexScript: SZ, rightToLeft: RTL, ...(RTL ? {} : { language: { value: LANG === 'fr' ? 'fr-FR' : 'en-US' } }) }, paragraph: { bidirectional: RTL } } },
    paragraphStyles: [
      hStyle('Heading1', 'heading 1', SZ + 8, {
        before: 360, after: 200, lvl: 0, align: AlignmentType.CENTER,
        paragraph: {
          shading: { type: ShadingType.CLEAR, fill: 'EEF1F7', color: 'auto' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 6 },
          },
        },
      }),
      hStyle('Heading2', 'heading 2', SZ + 4, {
        before: 280, after: 140, lvl: 1,
        paragraph: { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 3 } } },
      }),
      hStyle('Heading3', 'heading 3', SZ + 2, { before: 220, after: 100, lvl: 2, color: '7A5C1A' }),
      tocStyle('TOC1', 'toc 1', 0), tocStyle('TOC2', 'toc 2', 400), tocStyle('TOC3', 'toc 3', 800),
    ],
  };

  const headingOf = (n) => {
    const lvl = n.level === 3 ? 'Heading3' : n.level === 2 ? 'Heading2' : 'Heading1';
    const text = n.label ? `${n.label}: ${n.title}` : n.title;
    return new Paragraph({
      style: lvl, bidirectional: RTL,
      pageBreakBefore: lvl === 'Heading1' && !!opt.chapterPageBreak && !n.first,
      children: [run(text, { size: undefined, bold: true, color: lvl === 'Heading3' ? '7A5C1A' : NAVY })],
    });
  };

  // ---------- الغلاف ----------
  const coverMode = ['frame', 'ornate', 'formal'].includes(meta.coverStyle) ? meta.coverStyle : 'frame';
  const ornate = coverMode === 'ornate';
  const topImg = ornate ? await ornament('#' + NAVY, '#' + GOLD, false) : null;
  const botImg = ornate ? await ornament('#' + NAVY, '#' + GOLD, true) : null;
  const imgW = 560, imgH = Math.round(560 * OH / OW);
  const band = (buf) => new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0 },
    children: [new ImageRun({ type: 'png', data: buf, transformation: { width: imgW, height: imgH },
      altText: { title: 'زخرفة', description: 'زخرفة هندسية', name: 'ornament' } })],
  });
  const rule = (before, after) => new Paragraph({
    spacing: { before, after }, children: [],
    border: { bottom: { style: BorderStyle.DOUBLE, size: 8, color: GOLD, space: 1 } },
  });
  const cc = (t, o = {}) => para([run(t, { size: (o.pt || 16) * 2, bold: o.bold, color: o.color })],
    { align: AlignmentType.CENTER, after: o.after == null ? 80 : o.after, before: o.before, line: o.line || 320 });
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noB = { top: none, bottom: none, left: none, right: none };

  // شعار الجامعة (اختياري)
  let logoPara = null;
  if (meta.logo && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(meta.logo)) {
    try {
      const sharp = require('sharp');
      const raw = Buffer.from(meta.logo.split(',')[1], 'base64');
      const png = await sharp(raw).resize({ height: 220, withoutEnlargement: true }).png().toBuffer();
      const m = await sharp(png).metadata();
      const h = 78, w = Math.round(h * m.width / m.height);
      logoPara = new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80 },
        children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h },
          altText: { title: 'شعار', description: 'شعار الجامعة', name: 'logo' } })] });
    } catch (e) { logoPara = null; }
  }

  const titleBox = new Table({
    width: { size: 8400, type: WidthType.DXA }, alignment: AlignmentType.CENTER, visuallyRightToLeft: RTL,
    columnWidths: [8400], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 8400, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
      margins: { top: 280, bottom: 280, left: 300, right: 300 },
      shading: { type: ShadingType.CLEAR, fill: 'F6F1E4', color: 'auto' },
      borders: {
        top: { style: BorderStyle.DOUBLE, size: 8, color: GOLD }, bottom: { style: BorderStyle.DOUBLE, size: 8, color: GOLD },
        left: { style: BorderStyle.SINGLE, size: 12, color: NAVY }, right: { style: BorderStyle.SINGLE, size: 12, color: NAVY },
      },
      children: [cc(meta.title || S('ctitle', 'عنوان البحث'), { pt: 26, bold: true, color: NAVY, after: 0, line: 480 })],
    })] })],
  });

  const students = (Array.isArray(meta.students) ? meta.students : String(meta.students || meta.student || '').split('\n'))
    .map((x) => clean(x).trim()).filter(Boolean);
  const stCell = [
    para([run(students.length > 1 ? S('by1', 'من إعداد الطلبة') : S('by2', 'من إعداد الطالب(ة)'), { size: 26, bold: true, color: GOLD })], { after: 30, line: 300 }),
    ...(students.length ? students : ['—']).map((st) => para([run(st, { size: 30, bold: true, color: NAVY })], { after: 20, line: 300 })),
    ...(meta.group ? [para([run(meta.group, { size: 24, color: '555555' })], { after: 20, line: 300 })] : []),
  ];
  const supCell = [
    para([run(S('sup', 'تحت إشراف'), { size: 26, bold: true, color: GOLD })], { align: AlignmentType.END, after: 30, line: 300 }),
    para([run([meta.supervisorRank, meta.supervisor].filter(Boolean).join(' ') || '—', { size: 30, bold: true, color: NAVY })], { align: AlignmentType.END, after: 20, line: 300 }),
  ];
  const infoTable = new Table({
    width: { size: 8400, type: WidthType.DXA }, alignment: AlignmentType.CENTER, visuallyRightToLeft: RTL,
    columnWidths: [4200, 4200], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [stCell, supCell].map((c) => new TableCell({
      width: { size: 4200, type: WidthType.DXA }, borders: noB, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: c })) })],
  });

  const levelLine = [meta.level, meta.specialty].filter(Boolean).join(' — ');
  const cover = [
    ornate ? band(topImg) : rule(0, 120),
    cc(meta.country || S('rep', 'الجمهورية الجزائرية الديمقراطية الشعبية'), { pt: 15, bold: true, color: NAVY, before: 160, after: 20 }),
    cc(meta.ministry || S('min', 'وزارة التعليم العالي والبحث العلمي'), { pt: 14, color: NAVY, after: 60 }),
    ...(logoPara ? [logoPara] : []),
    cc(meta.university, { pt: 18, bold: true, color: NAVY, after: 20 }),
    cc([meta.faculty, meta.department].filter(Boolean).join(' — '), { pt: 14, color: '555555', after: levelLine ? 20 : 500 }),
    ...(levelLine ? [cc(levelLine, { pt: 14, color: '555555', after: 500 })] : []),
    cc(meta.kind || 'بحث في مقياس', { pt: 16, color: GOLD, bold: true, after: 40 }),
    cc(meta.subject, { pt: 18, bold: true, color: NAVY, after: 300 }),
    titleBox,
    new Paragraph({ spacing: { before: 700, after: 0 }, children: [] }),
    infoTable,
    cc(meta.year ? `${S('yr', 'السنة الجامعية: ')}${meta.year}` : '', { pt: 16, bold: true, color: NAVY, before: 700, after: 360 }),
    ornate ? band(botImg) : rule(120, 0),
  ];


  // ---------- غلاف الصورة المزخرفة (الإطار المرفوع) ----------
  // الصورة بنسبة A4 وتغطي الصفحة كاملة خلف النص؛ مواضع النص محسوبة على إحداثياتها
  const FR = { ovalTop: 2984, ovalH: 896, ovalW: 6070, yearY: 14450 };
  const buildFrameCover = () => {
    const EX = (line) => ({ line, lineRule: LineRuleType.EXACT });
    const T = (text, pt, o = {}) => new Paragraph({
      bidirectional: RTL, alignment: o.align || AlignmentType.CENTER,
      spacing: { ...EX(o.line || Math.round(pt * 24)), before: o.before || 0, after: 0 },
      children: [run(text, { size: pt * 2, bold: o.bold, color: o.color })],
    });
    const out = []; let y = FR.ovalTop + FR.ovalH;

    // العنوان داخل الإطار البيضوي
    const t = clean(meta.title || S('ctitle', 'عنوان البحث')); const n = t.length;
    const tpt = n <= 34 ? 18 : n <= 70 ? 14 : n <= 105 ? 12 : 10;
    out.push(new Table({
      width: { size: FR.ovalW, type: WidthType.DXA }, alignment: AlignmentType.CENTER, visuallyRightToLeft: RTL,
      columnWidths: [FR.ovalW], layout: TableLayoutType.FIXED,
      rows: [new TableRow({ height: { value: FR.ovalH, rule: HeightRule.EXACT }, children: [new TableCell({
        width: { size: FR.ovalW, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: noB,
        margins: { top: 0, bottom: 0, left: 80, right: 80 },
        children: [T(t, tpt, { bold: true, color: NAVY })],
      })] })],
    }));

    const add = (p, h) => { out.push(p); y += h; };
    const gap = 4780 - y; // أسفل زخرفة الإطار البيضوي
    add(new Paragraph({ spacing: { ...EX(Math.max(20, gap)), before: 0, after: 0 }, children: [] }), Math.max(20, gap));
    add(T(meta.country || S('rep', 'الجمهورية الجزائرية الديمقراطية الشعبية'), 15, { bold: true, color: NAVY }), 360);
    add(T(meta.ministry || S('min', 'وزارة التعليم العالي والبحث العلمي'), 14, { color: NAVY }), 336);
    if (logoPara) { out.push(logoPara); y += 1330; }
    add(T(meta.university, 18, { bold: true, color: NAVY, before: 60 }), 432 + 60);
    const fd = [meta.faculty, meta.department].filter(Boolean).join(' — ');
    if (fd) add(T(fd, 14, { color: '444444' }), 336);
    const lv = [meta.level, meta.specialty].filter(Boolean).join(' — ');
    if (lv) add(T(lv, 14, { color: '444444' }), 336);
    add(T(meta.kind || 'بحث في مقياس', 16, { bold: true, color: GOLD, before: 260 }), 384 + 260);
    if (meta.subject) add(T(meta.subject, 18, { bold: true, color: NAVY }), 432);

    // الطلبة والمشرف
    const sts = (Array.isArray(meta.students) ? meta.students : String(meta.students || meta.student || '').split('\n'))
      .map((x) => clean(x).trim()).filter(Boolean);
    const L = 340;
    const stCell = [
      T(sts.length > 1 ? S('by1', 'من إعداد الطلبة') : S('by2', 'من إعداد الطالب(ة)'), 13, { bold: true, color: GOLD, align: AlignmentType.START, line: L }),
      ...(sts.length ? sts : ['—']).map((x) => T(x, 15, { bold: true, color: NAVY, align: AlignmentType.START, line: L })),
      ...(meta.group ? [T(meta.group, 12, { color: '555555', align: AlignmentType.START, line: L })] : []),
    ];
    const supCell = [
      T(S('sup', 'تحت إشراف'), 13, { bold: true, color: GOLD, align: AlignmentType.END, line: L }),
      T([meta.supervisorRank, meta.supervisor].filter(Boolean).join(' ') || '—', 15, { bold: true, color: NAVY, align: AlignmentType.END, line: L }),
    ];
    out.push(new Paragraph({ spacing: { ...EX(20), before: 380, after: 0 }, children: [] })); y += 400;
    out.push(new Table({
      width: { size: 8300, type: WidthType.DXA }, alignment: AlignmentType.CENTER, visuallyRightToLeft: RTL,
      columnWidths: [4150, 4150], layout: TableLayoutType.FIXED,
      rows: [new TableRow({ children: [stCell, supCell].map((c) => new TableCell({
        width: { size: 4150, type: WidthType.DXA }, borders: noB, margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: c })) })],
    }));
    y += stCell.length * L + 80;

    // السنة الجامعية في الفراغ بين زخرفتي الأسفل + الصورة الخلفية
    const yearTxt = meta.year ? `${S('yr', 'السنة الجامعية: ')}${meta.year}` : '';
    const before = Math.max(240, FR.yearY - y);
    out.push(T(yearTxt || ' ', 16, { bold: true, color: NAVY, before }));

    let bg = null;
    try { bg = fs.readFileSync(path.join(__dirname, 'cover-frame.jpg')); } catch (e) { bg = null; }
    out.push(new Paragraph({
      spacing: { ...EX(20), before: 0, after: 0 },
      children: bg ? [new ImageRun({
        type: 'jpg', data: bg, transformation: { width: 794, height: 1123 },
        altText: { title: 'إطار الغلاف', description: 'إطار مزخرف', name: 'cover-frame' },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
          behindDocument: true, allowOverlap: true, lockAnchor: false, wrap: { type: TextWrappingType.NONE },
        },
      })] : [],
    }));
    return out;
  };

  const A4 = { width: 11906, height: 16838 };
  const mk = (f, c) => {
    const d = FRAMES[f]; if (!d) return undefined;
    const b = { style: d.style, size: d.size, color: c, space: 24 };
    return {
      pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE, zOrder: PageBorderZOrder.FRONT },
      pageBorderTop: b, pageBorderBottom: b, pageBorderLeft: b, pageBorderRight: b,
    };
  };

  // ---------- المتن ----------
  const body = [];
  if (opt.toc !== false) {
    body.push(new Paragraph({
      style: 'Normal', bidirectional: RTL, alignment: AlignmentType.CENTER, spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: GOLD, space: 6 } },
      children: [run(S('toc', 'فهرس المحتويات'), { size: SZ + 10, bold: true, color: NAVY })],
    }));
    body.push(new TableOfContents(S('toc', 'فهرس المحتويات'), { hyperlink: true, headingStyleRange: '1-3' }));
    body.push(new Paragraph({ children: [], pageBreakBefore: true }));
  }
  let firstH1 = true;
  nodes.forEach((n) => {
    if (!n || !n.title) return;
    const first = firstH1 && (n.level || 1) === 1; if (first) firstH1 = false;
    body.push(headingOf({ ...n, first: first && opt.toc !== false }));
    body.push(...bodyParas(n.body, isFramed(n)));
  });
  if (refs.length) {
    body.push(headingOf({ level: 1, title: S('refs', 'قائمة المصادر والمراجع') }));
    refs.forEach((r, i) => body.push(para([run(`${i + 1}. ${r}`)], {
      align: AlignmentType.START, rest: { indent: { left: 567, hanging: 567 } }, after: 100, line: 300 })));
  }

  const shortTitle = clean(meta.title || '').slice(0, 80);
  const doc = new Document({
    creator: 'رضا بلاتفورم إكسبوزي', title: clean(meta.title || 'بحث'),
    features: { updateFields: true },
    styles,
    numbering: { config: [{ reference: 'bul', levels: [{
      level: 0, format: LevelFormat.BULLET, text: '◆', alignment: AlignmentType.START,
      style: { run: { color: GOLD, size: 18 }, paragraph: { indent: { left: 720, hanging: 360 } } },
    }] }] },
    sections: [
      {
        properties: { page: { size: A4, margin: coverMode === 'frame' ? { top: FR.ovalTop, bottom: 200, left: 1700, right: 1700, header: 0, footer: 0 } : { top: 1000, bottom: 1000, left: 1100, right: 1100 }, borders: coverMode === 'frame' ? undefined : mk('classic', GOLD) },
          },
        children: coverMode === 'frame' ? buildFrameCover() : cover,
      },
      {
        properties: { page: { size: A4, margin: { top: 1440, bottom: 1300, left: 1417, right: 1417 },
          pageNumbers: { start: 1 }, borders: mk(frame, NAVY) } },
        headers: { default: new Header({ children: [new Paragraph({
          bidirectional: RTL, alignment: AlignmentType.START,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
          children: [run(shortTitle, { size: 20, color: '777777' })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({
          bidirectional: RTL, alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '— ', font, color: GOLD, size: 22 }),
            new TextRun({ children: [PageNumber.CURRENT], font, bold: true, color: NAVY, size: 24 }),
            new TextRun({ text: ' —', font, color: GOLD, size: 22 }),
          ] })] }) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx };
