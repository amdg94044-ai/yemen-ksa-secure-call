const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');

// إعدادات خوادم STUN المجانية من جوجل للمساعدة في ربط الأجهزة خلف جدران الحماية
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let localStream;
let peerConnection;
let roomId = new URLSearchParams(window.location.search).get('room');

// 1. التحقق من وجود الغرفة في الرابط أو إنشاء واحدة جديدة فوراً
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.history.replaceState({}, '', `?room=${roomId}`);
}

// 2. تشغيل الكاميرا والميكروفون للمستخدم الحالي
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStream = stream;
        document.getElementById('local-video').srcObject = stream;
        statusMessage.innerText = `في الغرفة: ${roomId} (انتظار الطرف الآخر...)`;

        // إبلاغ السيرفر بالانضمام للغرفة
        socket.emit('join-room', roomId, socket.id);

        // عندما ينضم مستخدم آخر، نبدأ بإنشاء الاتصال معه
        socket.on('user-connected', userId => {
            statusMessage.innerText = "جاري الاتصال بالطرف الآخر...";
            initiateCall(userId);
        });
    })
    .catch(error => {
        console.error('خطأ في الوصول للكاميرا/الميكروفون:', error);
        statusMessage.innerText = "فشل الوصول للكاميرا أو المايكروفون. يرجى إعطاء الصلاحية.";
    });

// 3. معالجة إشارات WebRTC القادمة من السيرفر لتمرير العروض والاتفاق
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

// 4. دالة بدء المكالمة وإرسال العرض (Offer)
async function initiateCall(userId) {
    createPeerConnection(userId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { to: userId, sdp: peerConnection.localDescription });
}

// 5. إنشاء اتصال الـ Peer وتجهيز القنوات
function createPeerConnection(userId) {
    peerConnection = new RTCPeerConnection(configuration);

    // إضافة المسارات الصوتية والمرئية المحلية للاتصال
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // استقبال الفيديو القادم من الطرف الآخر وعرضه
    peerConnection.ontrack = (event) => {
        let remoteVideo = document.getElementById('remote-video');
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = 'remote-video';
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            videoGrid.appendChild(remoteVideo);
        }
        remoteVideo.srcObject = event.streams[0];
        statusMessage.innerText = "🔒 اتصال مباشر مشفر ونشط الآن";
    };

    // إرسال مرشحي الحماية (ICE Candidates) عبر السيرفر للطرف الآخر
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: userId, ice: event.candidate });
        }
    };
}

// 6. أزرار التحكم في الواجهة (كتم الصوت، إيقاف الفيديو، الإنهاء)
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