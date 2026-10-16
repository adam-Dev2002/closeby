import { mediaJson, type CallMode, type DeviceAccess, type IceServer } from './calls';

export type MediaConfig = { channel: string; role: 'caller' | 'callee'; mode: CallMode; access?: DeviceAccess; iceServers: IceServer[]; parentOrigin?: string };
export const callMediaOrigin = 'https://closeby.local';
export function isCallMediaSource(url: string | undefined): boolean {
  // Android's WebMessageListener reports the source origin without a path;
  // older bridges and iOS report the document URL instead.
  return !url || url === 'about:blank' || url === callMediaOrigin || url.startsWith(`${callMediaOrigin}/`);
}
// This document contains only owned code. Firebase/session tokens never enter it.
export function callMediaHtml(config: MediaConfig): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; connect-src 'none';"><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#101A25;color:#F2F6FE;font:14px system-ui;overflow:hidden}.stage{position:relative;width:100%;height:100%;min-height:180px;background:#08131E;border-radius:16px;overflow:hidden}video{background:#08131E;object-fit:cover}#remote{width:100%;height:100%}#local{position:absolute;right:12px;bottom:12px;width:92px;height:128px;border:2px solid #FFFFFFB0;border-radius:14px;transform:scaleX(-1)}.badge{position:absolute;left:12px;top:12px;padding:6px 10px;border-radius:20px;background:#08131ECC;font-size:11px}#voice{display:none;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:15px}.circle{width:82px;height:82px;border-radius:50%;display:grid;place-items:center;background:#1186FF;font-size:32px}#status{color:#91A6BE;font-size:12px;text-align:center;padding:10px}.voice video{display:none}.voice #voice{display:flex}.voice .badge{display:none}
  .sharing #local{position:static;width:100%;height:100%;border:0;border-radius:0}.receiving #local{display:none}
  </style></head><body><div id="stage" class="stage"><video id="remote" autoplay playsinline webkit-playsinline></video><video id="local" autoplay muted playsinline webkit-playsinline></video><span id="badge" class="badge">Your camera is on</span><div id="voice"><div class="circle" aria-hidden="true">&#9742;</div><strong id="title">Voice call</strong><span id="status">Connecting audio...</span></div><audio id="audio" autoplay></audio></div><script>
  'use strict';const config=${mediaJson(config)};
  let peer=null,stream=null,closed=false,remoteSdp=null,chain=Promise.resolve(),muted=false,cameraOff=false,disconnectedTimer=null;
  const seen=new Set(),pending=[],stage=document.getElementById('stage'),local=document.getElementById('local'),remote=document.getElementById('remote'),audio=document.getElementById('audio');
  const receiving=Boolean(config.access)&&config.role==='caller',sharing=Boolean(config.access)&&config.role==='callee';
  if(config.mode==='voice')stage.classList.add('voice');
  if(sharing){stage.classList.add('sharing');remote.style.display='none';document.getElementById('badge').textContent='Sharing your '+(config.access==='back'?'rear':'front')+' camera and microphone';document.getElementById('title').textContent='Sharing your microphone';}
  if(receiving){stage.classList.add('receiving');document.getElementById('badge').textContent='Receiving approved camera';document.getElementById('title').textContent='Live microphone';}
  if(config.access==='back')local.style.transform='none';
  function send(event){const value={channel:config.channel,...event};if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(value));else if(window.parent!==window)window.parent.postMessage(value,config.parentOrigin||location.origin);}
  function stop(){if(closed)return;closed=true;clearTimeout(disconnectedTimer);if(stream)stream.getTracks().forEach(track=>track.stop());if(peer){peer.onicecandidate=null;peer.ontrack=null;peer.onconnectionstatechange=null;peer.close();}local.srcObject=null;remote.srcObject=null;audio.srcObject=null;}
  function fail(message){stop();send({type:'error',message});}
  function mediaError(error){if(error&&error.name==='NotAllowedError')return 'Camera or microphone permission was denied. You can allow it in your phone or browser settings.';if(error&&error.name==='OverconstrainedError')return 'The approved camera is unavailable. Ask for a new request for another camera.';if(error&&error.name==='NotFoundError')return 'This device has no available camera or microphone for this call.';return 'Camera or microphone could not start. Close other camera apps and try again.';}
  const ready=(async()=>{
    if(!window.isSecureContext||(!receiving&&(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia))){fail('Calls need a secure browser page. Use localhost on your computer, HTTPS, or the rebuilt Closeby Android app.');return false;}
    if(!window.RTCPeerConnection){fail('This browser or Android WebView does not support voice and video calls. Update it and try again.');return false;}
    try{
      if(!receiving){
        if(sharing&&config.mode==='video'&&(!navigator.mediaDevices.getSupportedConstraints||!navigator.mediaDevices.getSupportedConstraints().facingMode)){fail('This device cannot confirm the requested camera. Use a voice call or microphone request instead.');return false;}
        const facing=config.access==='back'?'environment':'user';
        stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:config.mode==='video'?{facingMode:sharing?{exact:facing}:'user',width:{ideal:640},height:{ideal:480}}:false});
        if(closed){stream.getTracks().forEach(track=>track.stop());return false;}
        if(sharing&&config.mode==='video'&&(!stream.getVideoTracks().length||stream.getVideoTracks().some(track=>track.getSettings().facingMode!==facing))){fail('The device could not confirm the approved camera. Start a new request.');return false;}
        local.srcObject=stream;local.play().catch(()=>{});
      }
      if(closed)return false;
      peer=new RTCPeerConnection({iceServers:config.iceServers});
      if(receiving){peer.addTransceiver('audio',{direction:'recvonly'});if(config.mode==='video')peer.addTransceiver('video',{direction:'recvonly'});}
      if(stream)stream.getTracks().forEach(track=>{track.enabled=track.kind==='audio'?!muted:!cameraOff;track.onended=()=>{if(!closed)fail('Camera or microphone access stopped on this device.');};peer.addTrack(track,stream);});
      peer.onicecandidate=event=>{if(!event.candidate||closed)return;const value=event.candidate.toJSON();send({type:'candidate',candidate:{candidate:value.candidate,sdpMid:value.sdpMid==null?null:value.sdpMid,sdpMLineIndex:value.sdpMLineIndex==null?null:value.sdpMLineIndex}});};
      peer.ontrack=event=>{if(closed)return;const received=event.streams[0]||new MediaStream([event.track]),element=config.mode==='voice'?audio:remote;if(element.srcObject!==received){element.srcObject=received;element.play().catch(error=>{if(!closed&&error.name!=='AbortError')fail('Your browser blocked call playback. Allow audio/video playback and start another call.');});}};
      peer.onconnectionstatechange=()=>{if(closed)return;const state=peer.connectionState;if(state==='connected'){clearTimeout(disconnectedTimer);document.getElementById('status').textContent=sharing?'Your microphone is shared live':receiving?'Receiving live audio':'Audio connected';send({type:'state',state:'connected'});}else if(state==='failed'||state==='closed'){fail('The call connection failed. Try again. A relay server may be needed between these networks.');}else if(state==='disconnected'){send({type:'state',state:'connecting'});clearTimeout(disconnectedTimer);disconnectedTimer=setTimeout(()=>fail('The call lost its network connection.'),15000);}else send({type:'state',state:'connecting'});};
      send({type:'ready'});send({type:'state',state:'connecting'});
      if(config.role==='caller'){const offer=await peer.createOffer();if(closed)return false;await peer.setLocalDescription(offer);send({type:'offer',description:{type:'offer',sdp:peer.localDescription.sdp}});}
      return true;
    }catch(error){if(!closed)fail(mediaError(error));return false;}
  })();
  async function apply(command){
    if(!command||command.channel!==config.channel||closed)return;
    if(command.type==='stop'){stop();return;}
    if(command.type==='controls'){muted=command.muted===true;cameraOff=command.cameraOff===true;if(stream)stream.getTracks().forEach(track=>{track.enabled=track.kind==='audio'?!muted:!cameraOff;});local.style.visibility=cameraOff?'hidden':'visible';document.getElementById('badge').textContent=receiving?'Receiving approved camera':cameraOff?'Your camera is paused':muted?'Your microphone is muted':sharing?'Sharing your '+(config.access==='back'?'rear':'front')+' camera and microphone':'Your camera is on';return;}
    if(!(await ready)||closed)return;
    if(command.type!=='remote')return;
    const description=command.description;
    if(description&&description.sdp!==remoteSdp){
      if((config.role==='caller'&&description.type!=='answer')||(config.role==='callee'&&description.type!=='offer'))return;
      await peer.setRemoteDescription(description);remoteSdp=description.sdp;
      for(const candidate of pending.splice(0))await peer.addIceCandidate(candidate);
      if(config.role==='callee'){const answer=await peer.createAnswer();if(closed)return;await peer.setLocalDescription(answer);send({type:'answer',description:{type:'answer',sdp:peer.localDescription.sdp}});}
    }
    for(const candidate of command.candidates||[]){if(!candidate||seen.has(candidate.id))continue;seen.add(candidate.id);const value={candidate:candidate.candidate,sdpMid:candidate.sdpMid,sdpMLineIndex:candidate.sdpMLineIndex};if(peer.remoteDescription)await peer.addIceCandidate(value);else pending.push(value);}
  }
  window.closebyCallUpdate=command=>{if(!command||command.channel!==config.channel)return;if(command.type==='stop'){stop();return;}chain=chain.then(()=>apply(command)).catch(()=>{if(!closed)fail('The call connection information could not be applied. Please try again.');});};
  window.addEventListener('message',event=>{if(event.source===window.parent&&event.origin===(config.parentOrigin||location.origin))window.closebyCallUpdate(event.data);});
  window.addEventListener('pagehide',stop);window.addEventListener('beforeunload',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();send({type:'state',state:'closed'});}});
  </script></body></html>`;
}
