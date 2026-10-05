# نظام الحضور الجامعي

## Firebase — اعمل الخطوات دي
1. افتح Firebase Console وأنشئ Project.
2. Project settings > Your apps > Web App ثم انسخ Firebase Config إلى `firebase-config.js`.
3. Authentication > Sign-in method > فعّل Email/Password.
4. Firestore Database > Create database.
5. Firestore > Rules: الصق محتوى `firestore.rules` ثم Publish.
6. Authentication > Settings > Authorized domains: أضف `YOURUSERNAME.github.io`.
7. ارفع ملفات ZIP كلها إلى GitHub Repository.
8. Settings > Pages > Deploy from branch > main > /(root).

## أول Admin
لا يوجد تسجيل Admin من الموقع.
1. أنشئ حسابًا عاديًا من الموقع.
2. من Authentication > Users انسخ UID.
3. من Firestore أنشئ collection اسمها `users`.
4. أنشئ document ID بنفس UID.
5. اجعل الحقول:
`uid` = UID
`name` = اسمك
`email` = بريدك
`role` = `admin`
`status` = `approved`
6. سجّل دخول من الموقع.

## ملاحظات مهمة
- لا تضع Service Account JSON أو private keys داخل GitHub.
- Firebase Web Config يمكن أن يكون في الواجهة؛ الحماية الفعلية من Authentication وFirestore Rules.
- QR مرتبط بالمحاضرة وبـtoken وجلسة لها وقت انتهاء.
- الكاميرا تحتاج HTTPS، لذلك GitHub Pages مناسب.
- النسخة الحالية تستخدم خدمة QR خارجية لتوليد صورة QR، بينما التحقق نفسه يتم داخل Firebase/session logic.

## تدفق الاستخدام
Admin -> يقبل الدكاترة والطلاب -> ينشئ المواد ويربطها بالدكتور.
Doctor -> ينشئ محاضرة -> يبدأ جلسة -> يعرض QR.
Student -> يسجل الدخول -> يمسح QR -> يسجل Present.
