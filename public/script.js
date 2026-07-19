const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');

// 1. إضافة خوادم STUN وخادم TURN المخصص لتخطي الحجب والشبكات المغلقة
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
            urls: 'turn:your-turn-server.com:3478', // ضع رابط خادم TURN الخاص بك هنا
            username: 'your_username',             // اسم المستخدم للخادم
            password: 'your_password'              // الرقم السري للخادم
        }
    ]
};

let localStream;
let peerConnection;
let roomId = new URLSearchParams(window.location.search).get('room');

if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.history.replaceState({}, '', `?room=${roomId}`);
}

// 2. تشغيل الكاميرا والميكروفون بإعدادات اقتصادية مخصصة للإنترنت الضعيف
navigator.mediaDevices.getUserMedia({ 
    audio: {
        echoCancellation: true,
        noiseSuppression: true  
    }, 
    video: {
        width: { ideal: 320, max: 480 },   
        height: { ideal: 240, max: 360 },  
        frameRate: { max: 15 }             
    } 
})
.then(stream => {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
    statusMessage.innerText = `في الغرفة: ${roomId} (انتظار الطرف الآخر...)`;

    socket.emit('join-room', roomId, socket.id);

    socket.on('user-connected', userId => {
        statusMessage.innerText = "جاري الاتصال بالطرف الآخر...";
        initiateCall(userId);
    });
})
.catch(error => {
    console.error('خطأ في الوصول للكاميرا/الميكروفون:', error);
    statusMessage.innerText = "فشل الوصول للكاميرا أو المايكروفون. يرجى إعطاء الصلاحية.";
});

socket.on('signal', async (data) => {
    if (!peerConnection) createPeerConnection(data.from);

    if (data.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, sdp: peerConnection.localDescription });
        }
    } else if (data.ice) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.ice));
        } catch (e) {
            console.error("خطأ في إضافة ICE candidate", e);
        }
    }
});

async function initiateCall(userId) {
    createPeerConnection(userId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { to: userId, sdp: peerConnection.localDescription });
}

// 3. إنشاء اتصال الـ Peer وتجهيز القنوات ومراقبة جودة الشبكة
function createPeerConnection(userId) {
    peerConnection = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // التعديل الرئيسي: ربط بث الطرف الآخر بالعنصر الثابت الموجود في الـ HTML
    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            statusMessage.innerText = "🔒 اتصال مباشر مشفر ونشط الآن";
        } else {
            console.error("لم يتم العثور على عنصر remote-video في الـ HTML");
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: userId, ice: event.candidate });
        }
    };

    // مراقبة حالة الاتصال لتفعيل خفض الجودة التلقائي (Adaptive Bitrate) عند نجاح الربط
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
            applyAdaptiveBitrate(peerConnection);
        }
    };
}

// 4. دالة التحكم في الـ Bitrate لمنع تقطع الفيديو والتحول التلقائي عند ضعف الإنترنت
function applyAdaptiveBitrate(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

    if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) {
            parameters.encodings = [{}];
        }
        
        // تحديد سقف البث بـ 300kbps كحد أقصى ليتناسب مع سرعات اليمن وضمان استمرار الصوت
        parameters.encodings[0].maxBitrate = 300000; 
        parameters.encodings[0].scaleResolutionDownBy = 1.5; // السماح بخفض الدقة تلقائياً عند هبوط الإشارة

        videoSender.setParameters(parameters)
            .then(() => console.log("✅ تم تفعيل Adaptive Bitrate وتحديد سقف الاستهلاك بنجاح."))
            .catch(err => console.error("⚠️ فشل ضبط إعدادات الـ Bitrate ديناميكياً:", err));
    }
}

document.getElementById('toggle-mic').addEventListener('click', (e) => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    e.target.innerText = audioTrack.enabled ? "كتم الصوت" : "تفعيل الصوت";
    e.target.classList.toggle('btn-mute');
});

document.getElementById('toggle-video').addEventListener('click', (e) => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    e.target.innerText = videoTrack.enabled ? "إيقاف الكاميرا" : "تشغيل الكاميرا";
    e.target.classList.toggle('btn-mute');
});

document.getElementById('end-call').addEventListener('click', () => {
    window.location.href = '/';
});