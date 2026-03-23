/**
 * Browser-side WebRTC helpers. Signaling is intended to flow over Holochain (`post_webrtc_signal` /
 * `list_recent_signals`) so only trusted peers need to see offers/answers. STUN is public; replace
 * with your own TURN for strict NAT.
 */

const ICE_SERVERS: RTCConfiguration['iceServers'] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS })
}

export async function attachLocalVideo(pc: RTCPeerConnection, videoEl: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream)
  }
  videoEl.srcObject = stream
  return stream
}

export function wireRemoteStream(pc: RTCPeerConnection, videoEl: HTMLVideoElement): void {
  pc.ontrack = (ev) => {
    const [stream] = ev.streams
    if (stream) videoEl.srcObject = stream
  }
}
