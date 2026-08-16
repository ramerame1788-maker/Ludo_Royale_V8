# Ludo Royale V8 — جاهز للنشر

هذه نسخة مرتبة من مشروع Ludo Royale V8، مع خادم Node.js + WebSocket وواجهة عربية.

## تشغيل محلي

```bash
npm ci
npm start
```

ثم افتحي:
`http://localhost:3000`

## نشر على Render

1. ارفعي محتويات هذا المشروع إلى GitHub.
2. في Render اختاري **New → Web Service**.
3. اختاري مستودع GitHub.
4. Render سيقرأ `render.yaml` تلقائياً، أو استخدمي:
   - Build Command: `npm ci`
   - Start Command: `npm start`
5. بعد اكتمال النشر افتحي رابط `onrender.com`.

### مهم
هذا المشروع يستخدم `data.json` لحفظ الحسابات والعملات. على الاستضافة المجانية قد لا تكون الملفات المحلية دائمة بعد بعض عمليات إعادة التشغيل/النشر. للنسخة الإنتاجية الأفضل نقل الحسابات والعملات إلى قاعدة بيانات مثل PostgreSQL.

## ما تم تجهيزه
- WebSocket يعمل من نفس رابط الموقع (`wss://` عند HTTPS).
- Health check على `/health`.
- الاستماع على `0.0.0.0` و`PORT` الخاص بالاستضافة.
- تنظيف ملفات Git و`.env` من نسخة التوزيع.
- إعداد `render.yaml` للنشر.
- إضافة heartbeat للـ WebSocket حتى لا تبقى الاتصالات الميتة معلقة.
