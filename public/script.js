/* ==========================================
   1. المتغيرات والتهيئة الأساسية
========================================== */
const socket = io();
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const chatMessages = document.getElementById('chat-messages');

// تهيئة المؤثرات الصوتية
const messageSound = new Audio("sounds/message.mp3");
const ringtone = new Audio("sounds/ringtone.mp3");
const callSound = new Audio("sounds/call.mp3");
const hangupSound = new Audio("sounds/hangup.mp3");
const micSound = new Audio("sounds/mic.mp3");
const cameraSound = new Audio("sounds/camera.mp3");
ringtone.loop = true;

// خوادم STUN و TURN
const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "135fb5bb6c9f89ff89f0943b",
            credential: "tfxTmux1XoagEtol"
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "135fb5bb6c9f89ff89f0943b",
            credential: "tfxTmux1XoagEtol"
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "135fb5bb6c9f89ff89f0943b",
            credential: "tfxTmux1XoagEtol"
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "135fb5bb6c9f89ff89f0943b",
            credential: "tfxTmux1XoagEtol"
        },
        {
            urls: "turn:free.expressturn.com:3478",
            username: "00000000209991425",
            credential: "Hx3Op5nHLhpTUEOu"
        }
    ],
    iceTransportPolicy: "all"
};

let localStream;
let peerConnection;
let iceCandidatesQueue = [];

// استخراج أو إنشاء معرف الغرفة (Room ID)
let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.history.replaceState({}, '', `?room=${roomId}`);
}

/* ==========================================
   2. الوصول للوسائط (الكاميرا والميكروفون)
========================================== */
navigator.mediaDevices.getUserMedia({ 
    audio: { echoCancellation: true, noiseSuppression: true }, 
    video: { width: { ideal: 320, max: 480 }, height: { ideal: 240, max: 360 }, frameRate: { max: 15 } } 
})
.then(stream => {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
    statusMessage.innerText = `في الغرفة: ${roomId} (انتظار الطرف الآخر...)`;

    if (socket.connected) {
        socket.emit('join-room', roomId, socket.id);
    } else {
        socket.on('connect', () => {
            socket.emit('join-room', roomId, socket.id);
        });
    }

    socket.off("user-connected");
    socket.on("user-connected", (userId) => {
        if (peerConnection) return;
        statusMessage.innerText = "جاري الاتصال بالطرف الآخر...";
        playCallSound();
        initiateCall(userId);
    });
})
.catch(error => {
    console.error('خطأ في الوصول للكاميرا/الميكروفون:', error);
    statusMessage.innerText = "فشل الوصول للكاميرا أو المايكروفون. يرجى إعطاء الصلاحية.";
});

/* ==========================================
   3. إدارة اتصال WebRTC وإشارات الاتصال
========================================== */
socket.on('signal', async (data) => {
    if (!peerConnection) createPeerConnection(data.from);

    if (data.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        
        while (iceCandidatesQueue.length > 0) {
            await peerConnection.addIceCandidate(iceCandidatesQueue.shift());
        }

        if (data.sdp.type === 'offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, sdp: peerConnection.localDescription });
        }
    } else if (data.ice) {
        if (peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.ice));
            } catch (e) {
                console.error("خطأ في إضافة ICE candidate", e);
            }
        } else {
            iceCandidatesQueue.push(new RTCIceCandidate(data.ice));
        }
    }
});

async function initiateCall(userId) {
    if (peerConnection) return;
    createPeerConnection(userId);

    const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });

    await peerConnection.setLocalDescription(offer);
    socket.emit("signal", { to: userId, sdp: peerConnection.localDescription });
}

function createPeerConnection(userId) {
    if (peerConnection && peerConnection.connectionState !== "closed") return;

    peerConnection = new RTCPeerConnection(configuration);

    if (!localStream) {
        console.error("Local stream غير جاهز");
        return;
    }

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById("remote-video");
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.play().catch(err => console.log("Play Error:", err));
        statusMessage.innerText = "🔒 اتصال مباشر مشفر ونشط الآن";
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: userId, ice: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE State:", peerConnection.iceConnectionState);
        switch (peerConnection.iceConnectionState) {
            case "checking":
                statusMessage.innerText = "🔍 جاري البحث عن أفضل مسار...";
                break;
            case "connected":
            case "completed":
                statusMessage.innerText = "✅ تم الاتصال";
                applyAdaptiveBitrate(peerConnection);
                break;
            case "disconnected":
                statusMessage.innerText = "⚠️ انقطع الاتصال... جاري إعادة المحاولة";
                break;
            case "failed":
                statusMessage.innerText = "🔄 إعادة محاولة الاتصال...";
                if (typeof peerConnection.restartIce === "function") {
                    peerConnection.restartIce();
                }
                break;
            case "closed":
                statusMessage.innerText = "تم إنهاء الاتصال";
                break;
        }
    };
}

function applyAdaptiveBitrate(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

    if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        
        parameters.encodings[0].maxBitrate = 300000; 
        parameters.encodings[0].scaleResolutionDownBy = 1.5; 

        videoSender.setParameters(parameters)
            .then(() => console.log("✅ تم تفعيل Adaptive Bitrate"))
            .catch(err => console.error("⚠️ فشل ضبط الـ Bitrate:", err));
    }
}

socket.on("user-disconnected", () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    const remoteVideo = document.getElementById("remote-video");
    if (remoteVideo) remoteVideo.srcObject = null;
    statusMessage.innerText = "تم فصل الطرف الآخر";
    playHangupSound();
});

/* ==========================================
   4. أحداث التحكم والدردشة (UI Events)
========================================== */
document.getElementById('toggle-mic').addEventListener('click', (e) => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        e.target.innerText = audioTrack.enabled ? "كتم الصوت" : "تفعيل الصوت";
        e.target.classList.toggle('btn-mute');
        playMicSound();
    }
});

document.getElementById('toggle-video').addEventListener('click', (e) => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        e.target.innerText = videoTrack.enabled ? "إيقاف الكاميرا" : "تشغيل الكاميرا";
        e.target.classList.toggle('btn-mute');
        playCameraSound();
    }
});

document.getElementById('end-call').addEventListener('click', () => {
    playHangupSound();
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    socket.disconnect();
    window.location.href = "/";
});

document.getElementById("fullscreen-remote").addEventListener("click", () => {
    const remoteVideo = document.getElementById("remote-video");
    if (!remoteVideo) return;

    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        if (remoteVideo.requestFullscreen) {
            remoteVideo.requestFullscreen();
        } else if (remoteVideo.webkitRequestFullscreen) {
            remoteVideo.webkitRequestFullscreen();
        } else if (remoteVideo.msRequestFullscreen) {
            remoteVideo.msRequestFullscreen();
        }
    }
});

// التعامل مع إرسال الرسائل
sendMessageBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    socket.emit("chat-message", text);
    addMessage("أنت", text);
    chatInput.value = "";
}

socket.on("chat-message", (msg) => {
    addMessage("الطرف الآخر", msg);
    playMessageSound();
});

function addMessage(sender, text) {
    const div = document.createElement("div");
    div.className = "message";
    div.innerHTML = `<strong>${sender}:</strong> ${text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ==========================================
   5. دالة تشغيل الأصوات
========================================== */
function playMessageSound() { messageSound.currentTime = 0; messageSound.play().catch(() => {}); }
function playCallSound() { ringtone.pause(); ringtone.currentTime = 0; callSound.currentTime = 0; callSound.play().catch(() => {}); }
function playRingtone() { ringtone.currentTime = 0; ringtone.play().catch(() => {}); }
function playHangupSound() { ringtone.pause(); ringtone.currentTime = 0; hangupSound.currentTime = 0; hangupSound.play().catch(() => {}); }
function playMicSound() { micSound.currentTime = 0; micSound.play().catch(() => {}); }
function playCameraSound() { cameraSound.currentTime = 0; cameraSound.play().catch(() => {}); }