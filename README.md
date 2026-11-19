# رضا بلاتفورم إكسبوزي

## التشغيل
1. ثبّت Node.js (18 أو أحدث) ثم داخل المجلد: `npm install`
2. مفتاح Gemini مجاني من https://aistudio.google.com ثم:
   - Windows (PowerShell): `$env:GEMINI_API_KEY="مفتاحك"; node server.js`
   - Mac/Linux: `GEMINI_API_KEY=مفتاحك node server.js`
3. افتح http://localhost:3000

بدون مفتاح يعمل الموقع بنصوص تجريبية ويبقى التصدير إلى Word كاملًا.

## الملفات
- `index.html` الواجهة كاملة في ملف واحد.
- `server.js` الخادم، و`docx-export.js` تصدير Word، و`ornament.js` زخرفة الغلاف، و`cover-frame.jpg` صورة الإطار.
