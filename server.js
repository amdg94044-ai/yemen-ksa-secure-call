const express = require('express');
const app = express();

const server = require('http').createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// تشغيل ملفات الموقع
app.use(express.static('public'));

io.on('connection', (socket) => {

    console.log("✅ مستخدم متصل:", socket.id);

    // دخول الغرفة
    socket.on('join-room', (roomId) => {

        socket.join(roomId);
        socket.roomId = roomId;

        console.log(`${socket.id} joined room ${roomId}`);

        // إبلاغ الموجودين بالغرفة
        socket.to(roomId).emit('user-connected', socket.id);

    });

    // تمرير إشارات WebRTC
    socket.on('signal', (data) => {

        if (!data.to) return;

        io.to(data.to).emit('signal', {
            from: socket.id,
            sdp: data.sdp,
            ice: data.ice
        });

    });

    // قطع الاتصال
    socket.on('disconnect', () => {

        console.log("❌ مستخدم خرج:", socket.id);

        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-disconnected', socket.id);
        }

    });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});