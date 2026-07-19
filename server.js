const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تشغيل ملفات الواجهة الأمامية من مجلد public
app.use(express.static('public'));

// إدارة غرف الاتصال وتبادل الإشارات
io.on('connection', (socket) => {
    
    // عند دخول مستخدم إلى غرفة معينة
    socket.on('join-room', (roomId, userId) => {
        socket.join(roomId);
        // إعلام المستخدمين الآخرين في نفس الغرفة بانضمام مستخدم جديد
        socket.to(roomId).emit('user-connected', userId);
        
        // ربط معرف المستخدم بالغرفة لتسهيل قطع الاتصال
        socket.roomId = roomId;
        socket.userId = userId;
    });

    // التعديل الهام: تمرير إشارات WebRTC بين الطرفين لتفعيل الكاميرا والصوت
    socket.on('signal', (data) => {
        if (data.to) {
            io.to(data.to).emit('signal', {
                from: socket.id,
                sdp: data.sdp,
                ice: data.ice
            });
        }
    });

    // معالجة خروج أو قطع اتصال أحد الأطراف
    socket.on('disconnect', () => {
        if (socket.roomId && socket.userId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.userId);
        }
    });
});

// تحديد منفذ التشغيل المتوافق مع منصة Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});