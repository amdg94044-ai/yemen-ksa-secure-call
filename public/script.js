/* ==========================================
   1. المتغيرات والتهيئة الأساسية
========================================== */
const socket = io();
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const chatMessages = document.getElementById('chat-messages');

// تعريف ملفات الصوت بأسماء الملفات المطابقة للصورة تماماً
const messageSound = new Audio("/sounds/Message Notification.mp3");
const ringtone = new Audio("/sounds/Phone Ring.wav");
const callSound = new Audio("/sounds/Call Connected.wav");
const hangupSound = new Audio("/sounds/Click.wav");
const micSound = new Audio("/sounds/Click.wav");
const cameraSound = new Audio("/sounds/Camera Click.wav");

ringtone.loop = true;

/* ==========================================
   2. محرك الأصوات وتهيئة Web Audio API
========================================== */
let audioCtx;
let isAudioUnlocked = false;

// دالة فك الحظر فور أي تفاعل للمستخدم
function unlockAudioSystem() {
    if (isAudioUnlocked) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    const allSounds = [messageSound, ringtone, callSound, hangupSound, micSound, cameraSound];
    allSounds.forEach(sound => {
        sound.muted = true;
        sound.play().then(() => {
            sound.pause();
            sound.currentTime = 0;
            sound.muted = false;
        }).catch(() => {
            sound.muted = false;
        });
    });

    isAudioUnlocked = true;
    console.log("✅ تم تفعيل نظام الأصوات بنجاح");

    window.removeEventListener('click', unlockAudioSystem);
    window.removeEventListener('keydown', unlockAudioSystem);
    window.removeEventListener('touchstart', unlockAudioSystem);
}

window.addEventListener('click', unlockAudioSystem);
window.addEventListener('keydown', unlockAudioSystem);
window.addEventListener('touchstart', unlockAudioSystem);

// دالة تشغيل آمنة وموحدة
function playSound(audioObj) {
    if (!audioObj) return;

    audioObj.currentTime = 0;
    const playPromise = audioObj.play();
    
    if (playPromise !== undefined) {
        playPromise.catch(err => {
            console.warn(`⚠️ تعذر تشغيل الصوت ${audioObj.src}:`, err.message);
        });
    }
}

// دوال التحكم بالأصوات
function playMessageSound() { playSound(messageSound); }
function playMicSound() { playSound(micSound); }
function playCameraSound() { playSound(cameraSound); }

function playCallSound() {
    ringtone.pause();
    ringtone.currentTime = 0;
    playSound(callSound);
}

function playRingtone() { playSound(ringtone); }

function playHangupSound() {
    ringtone.pause();
    ringtone.currentTime = 0;
    playSound(hangupSound);
}

/* ==========================================
   3. إعدادات WebRTC والاتصال
========================================== */
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

let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.history.replaceState({}, '', `?room=${roomId}`);
}

/* ==========================================
   4. الوصول للوسائط (تعديل الأبعاد لدعم الإطار الأكبر)
========================================== */
navigator.mediaDevices.getUserMedia({ 
    audio: { echoCancellation: true, noiseSuppression: true }, 
    video: { 
        width: { ideal: 1280, max: 1920 }, 
        height: { ideal: 720, max: 1080 }, 
        frameRate: { ideal: 30 } 
    } 
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
   5. إشارات WebRTC
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

// تحسين معدل البث (Bitrate) لاستغلال الحجم الجديد للإطارات بدقة أعلى
function applyAdaptiveBitrate(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

    if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        
        parameters.encodings[0].maxBitrate = 1500000; // رفع معدل البيانات لـ 1.5Mbps لوضوح عالي
        parameters.encodings[0].scaleResolutionDownBy = 1.0; 

        videoSender.setParameters(parameters).catch(err => console.error("Bitrate Error:", err));
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
   6. أحداث التحكم والدردشة (UI Events)
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
// متغير لتحديد الكاميرا الحالية ('user' تعني الأمامية، 'environment' تعني الخلفية)
let currentFacingMode = 'user';

const switchCamBtn = document.getElementById('switch-camera');

if (switchCamBtn) {
    switchCamBtn.addEventListener('click', async () => {
        if (!localStream) return;

        // التبديل بين الأمامية والخلفية
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';

        try {
            // 1. إيقاف مسار الفيديو الحالي
            const oldVideoTrack = localStream.getVideoTracks()[0];
            if (oldVideoTrack) {
                oldVideoTrack.stop();
            }

            // 2. طلب مسار فيديو جديد بالكاميرا المختارة
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: currentFacingMode }
            });

            const newVideoTrack = newStream.getVideoTracks()[0];

            // 3. استبدال المسار القديم في البث المحلي
            localStream.removeTrack(oldVideoTrack);
            localStream.addTrack(newVideoTrack);

            // 4. تحديث العرض في الشاشة المحلية مع تعديل وضع المرآة (المرآة فقط للكاميرا الأمامية)
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = localStream;
            localVideo.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'none';

            // 5. إرسال المسار الجديد للطرف الآخر إذا كان الاتصال قائماً
            if (peerConnection) {
                const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(newVideoTrack);
                }
            }
        } catch (error) {
            console.error("خطأ عند تبديل الكاميرا:", error);
            alert("تعذر تبديل الكاميرا، قد يكون جهازك لا يمتلك كاميرا ثانية أو المتصفح يمنع الإذن.");
            // إعادة الوضع للمقدار السابق في حال الفشل
            currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        }
    });
}