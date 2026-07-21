/* ==========================================
   1. المتغيرات والتهيئة الأساسية
========================================== */
const socket = io();
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const chatMessages = document.getElementById('chat-messages');

// تعريف ملفات الصوت مع المسارات المطلقة
const messageSound = new Audio("/sounds/message.mp3");
const ringtone = new Audio("/sounds/ringtone.mp3");
const callSound = new Audio("/sounds/call.mp3");
const hangupSound = new Audio("/sounds/hangup.mp3");
const micSound = new Audio("/sounds/mic.mp3");
const cameraSound = new Audio("/sounds/camera.mp3");

ringtone.loop = true;

/* ==========================================
   2. محرك الأصوات وتهيئة Web Audio API
========================================== */
let audioCtx;
let isAudioUnlocked = false;

// دالة فك الحظر فور أي تفاعل للمستخدم
function unlockAudioSystem() {
    if (isAudioUnlocked) return;

    // 1. تهيئة Web Audio Context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // 2. تهيئة كافة أسطوانات الـ Audio
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
    console.log("✅ تم تفعيل وتشغيل نظام الأصوات بنجاح");

    window.removeEventListener('click', unlockAudioSystem);
    window.removeEventListener('keydown', unlockAudioSystem);
    window.removeEventListener('touchstart', unlockAudioSystem);
}

// الاستماع لأي تفاعل من المستخدم
window.addEventListener('click', unlockAudioSystem);
window.addEventListener('keydown', unlockAudioSystem);
window.addEventListener('touchstart', unlockAudioSystem);

// دالة تشغيل آمنة تجمع بين ملف MP3 ونغمة احتياطية
function playAudioSafe(audioObj, fallbackFreq = 440) {
    if (!audioObj) return;

    audioObj.currentTime = 0;
    audioObj.play().catch(err => {
        console.warn(`⚠️ فشل تشغيل ${audioObj.src}، جاري استخدام النغمة البديلة:`, err.message);
        playFallbackBeep(fallbackFreq);
    });
}

// صوت احتياطي برمجياً (Beep) عند فقدان ملفات mp3 أو حظرها
function playFallbackBeep(freq = 440) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.error("خطأ في النغمة البديلة:", e);
    }
}

// دوال التحكم بالأصوات
function playMessageSound() { playAudioSafe(messageSound, 800); }
function playMicSound() { playAudioSafe(micSound, 600); }
function playCameraSound() { playAudioSafe(cameraSound, 500); }

function playCallSound() {
    ringtone.pause();
    ringtone.currentTime = 0;
    playAudioSafe(callSound, 700);
}

function playRingtone() { playAudioSafe(ringtone, 440); }

function playHangupSound() {
    ringtone.pause();
    ringtone.currentTime = 0;
    playAudioSafe(hangupSound, 300);
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
   4. الوصول للوسائط (الكاميرا والميكروفون)
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

function applyAdaptiveBitrate(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

    if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        
        parameters.encodings[0].maxBitrate = 300000; 
        parameters.encodings[0].scaleResolutionDownBy = 1.5; 

        videoSender.setParameters(parameters).catch(err => console.error(" Bitrate Error:", err));
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