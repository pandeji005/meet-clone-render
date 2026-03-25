const socket = io();

// State
let localStream;
let roomId;
let peers = {}; // sid -> RTCPeerConnection
let isAudioMuted = false;
let isVideoMuted = false;

// DOM Elements
const joinScreen = document.getElementById('join-screen');
const meetingScreen = document.getElementById('meeting-screen');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('localVideo');
const previewVideo = document.getElementById('previewVideo');

// Controls
const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const leaveBtn = document.getElementById('leaveBtn');
const previewMicBtn = document.getElementById('previewMicBtn');
const previewCamBtn = document.getElementById('previewCamBtn');

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Initialization & Preview ---

async function initPreview() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        previewVideo.srcObject = localStream;
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access camera and microphone. Please allow permissions.');
    }
}

initPreview();

// --- Event Listeners ---

joinBtn.addEventListener('click', () => {
    roomId = roomInput.value.trim();
    if (!roomId) {
        alert("Please enter a Room ID");
        return;
    }

    // Switch Screens
    joinScreen.classList.remove('active');
    meetingScreen.classList.add('active');

    // Emit Join event
    socket.emit('join', { room: roomId });
});

function toggleAudio() {
    if (!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    
    // Update UI for both preview and meeting controls
    const iconStr = isAudioMuted ? 'mic_off' : 'mic';
    
    micBtn.classList.toggle('active', !isAudioMuted);
    micBtn.querySelector('span').innerText = iconStr;
    
    previewMicBtn.classList.toggle('active', !isAudioMuted);
    previewMicBtn.querySelector('span').innerText = iconStr;
}

function toggleVideo() {
    if (!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks()[0].enabled = !isVideoMuted;
    
    const iconStr = isVideoMuted ? 'videocam_off' : 'videocam';
    
    camBtn.classList.toggle('active', !isVideoMuted);
    camBtn.querySelector('span').innerText = iconStr;
    
    previewCamBtn.classList.toggle('active', !isVideoMuted);
    previewCamBtn.querySelector('span').innerText = iconStr;
}

micBtn.addEventListener('click', toggleAudio);
previewMicBtn.addEventListener('click', toggleAudio);
camBtn.addEventListener('click', toggleVideo);
previewCamBtn.addEventListener('click', toggleVideo);

leaveBtn.addEventListener('click', () => {
    // Close all peer connections
    for (let sid in peers) {
        peers[sid].close();
        removeVideoElement(sid);
        delete peers[sid];
    }
    
    // Note: We don't stop the localStream tracks so they are ready if user joins another room.
    
    // Redirect to dashboard
    window.location.href = '/';
});

// --- WebRTC Logic ---

// When a new user joins, THEY send a 'user-joined' to US.
// Since we are already in the room, WE should initiate the call (offer).
socket.on('user-joined', async (data) => {
    const peerSid = data.sid;
    console.log('User joined:', peerSid);
    
    // Add placeholder immediately
    addVideoElement(peerSid, null);
    
    const pc = createPeerConnection(peerSid);
    
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('signal', {
        room: roomId,
        to: peerSid,
        data: pc.localDescription
    });
});

socket.on('signal', async (message) => {
    const peerSid = message.sid;
    const signalData = message.data;
    
    if (peerSid === socket.id) return; // Prevent self-signaling just in case
    
    let pc = peers[peerSid];
    
    // If we receive an offer from someone, and we don't have a PC for them, create it
    if (!pc) {
        addVideoElement(peerSid, null);
        pc = createPeerConnection(peerSid);
    }

    if (signalData.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('signal', {
            room: roomId,
            to: peerSid,
            data: pc.localDescription
        });
    } else if (signalData.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData));
    } else if (signalData.candidate) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(signalData));
        } catch (e) {
            console.error('Error adding ICE candidate', e);
        }
    }
});

function createPeerConnection(peerSid) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peers[peerSid] = pc;

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle ICE Candidates
    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('signal', {
                room: roomId,
                to: peerSid,
                data: event.candidate
            });
        }
    };

    // Handle incoming remote stream
    pc.ontrack = event => {
        const stream = event.streams[0];
        addVideoElement(peerSid, stream);
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            removeVideoElement(peerSid);
            pc.close();
            delete peers[peerSid];
        }
    };

    return pc;
}

// --- UI Helpers ---

function addVideoElement(peerSid, stream) {
    if (document.getElementById(`video-${peerSid}`)) {
        if (stream) {
            document.getElementById(`video-${peerSid}`).srcObject = stream;
        }
        return;
    }

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `container-${peerSid}`;

    const placeholder = document.createElement('div');
    placeholder.className = 'user-placeholder';
    placeholder.innerHTML = `<span class="material-symbols-outlined" style="font-size: 64px; color: rgba(255,255,255,0.2);">person</span>`;
    container.appendChild(placeholder);

    const video = document.createElement('video');
    video.id = `video-${peerSid}`;
    if (stream) {
        video.srcObject = stream;
    }
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement('div');
    label.className = 'user-label';
    label.innerText = `Guest-${peerSid.substring(0,4)}`;

    container.appendChild(video);
    container.appendChild(label);
    videoGrid.appendChild(container);
}

function removeVideoElement(peerSid) {
    const container = document.getElementById(`container-${peerSid}`);
    if (container) {
        container.remove();
    }
}