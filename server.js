const express = require('express');
const app = express();
const server = require('http').createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تشغيل ملفات الموقع العادية (Static Files)
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log("✅ مستخدم متصل:", socket.id);

    // 1. دخول الغرفة
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;

        console.log(`👤 ${socket.id} انضم إلى الغرفة: ${roomId}`);

        // إبلاغ بقية الأعضاء في الغرفة بوجود مستخدم جديد
        socket.to(roomId).emit('user-connected', socket.id);
    });

    // 2. تمرير إشارات WebRTC بين الأطراف
    socket.on('signal', (data) => {
        if (!data.to) return;

        io.to(data.to).emit('signal', {
            from: socket.id,
            sdp: data.sdp,
            ice: data.ice
        });
    });

    // 3. استقبال وإعادة إرسال رسائل الدردشة داخل نفس الغرفة فقط
    socket.on('chat-message', (msg) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('chat-message', msg);
        }
    });

    // 4. معالجة قطع الاتصال
    socket.on('disconnect', () => {
        console.log("❌ مستخدم خرج:", socket.id);

        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل بنجاح على المنفذ: ${PORT}`);
});