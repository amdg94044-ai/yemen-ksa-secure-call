const socket = io();
const videoGrid = document.getElementById('video-grid');
const statusMessage = document.getElementById('status-message');

// 1. استخدام خوادم STUN من جوجل فقط (تم إزالة خادم TURN الوهمي لأنه يسبب تعليق الاتصال)
// 1. استخدام خوادم Metered الاحترافية لضمان تجاوز الحجب والاتصال المباشر
const configuration = {
    iceServers: [
        // STUN - المحاولة الأولى (اتصال مباشر)
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },

        // Metered TURN (الاحتياطي الأول)
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

        // ExpressTURN (احتياطي أخير)
        {
            urls: "turn:free.expressturn.com:3478",
            username: "00000000209991425",
            credential: "Hx3Op5nHLhpTUEOu"
        }
    ],

    // يسمح للمتصفح باختيار أفضل مسار تلقائيًا
    iceTransportPolicy: "all"
};

let localStream;
let peerConnection;
let roomId = new URLSearchParams(window.location.search).get('room');
let iceCandidatesQueue = []; // طابور لحفظ الإشارات التي تصل مبكراً

if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.history.replaceState({}, '', `?room=${roomId}`);
}

// 2. تشغيل الكاميرا والميكروفون
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

    initiateCall(userId);

});
})
.catch(error => {
    console.error('خطأ في الوصول للكاميرا/الميكروفون:', error);
    statusMessage.innerText = "فشل الوصول للكاميرا أو المايكروفون. يرجى إعطاء الصلاحية.";
});

// 3. معالجة الإشارات وإصلاح مشكلة "سباق الإشارات"
socket.on('signal', async (data) => {
    if (!peerConnection) createPeerConnection(data.from);

    if (data.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        
        // تفريغ طابور الإشارات المعلقة بمجرد جاهزية الاتصال
        while(iceCandidatesQueue.length > 0) {
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
            // إذا وصلت الإشارة قبل جاهزية الاتصال، ضعها في الطابور
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

    socket.emit("signal", {
        to: userId,
        sdp: peerConnection.localDescription
    });

}

function createPeerConnection(userId) {

    if (peerConnection &&
        peerConnection.connectionState !== "closed") {
        return;
    }

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

    remoteVideo.play().catch(err => {
    console.log("Play Error:", err);
});

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

};   // نهاية oniceconnectionstatechange

}    // نهاية createPeerConnection
function applyAdaptiveBitrate(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

    if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) {
            parameters.encodings = [{}];
        }
        
        parameters.encodings[0].maxBitrate = 300000; 
        parameters.encodings[0].scaleResolutionDownBy = 1.5; 

        videoSender.setParameters(parameters)
            .then(() => console.log("✅ تم تفعيل Adaptive Bitrate"))
            .catch(err => console.error("⚠️ فشل ضبط الـ Bitrate:", err));
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

    if (peerConnection) {
        peerConnection.close();
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    socket.disconnect();

    window.location.href = "/";
});

socket.on("user-disconnected", () => {

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    const remoteVideo = document.getElementById("remote-video");

    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }

    statusMessage.innerText = "تم فصل الطرف الآخر";

});
document.getElementById("fullscreen-remote").addEventListener("click", () => {

    const remoteVideo = document.getElementById("remote-video");

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