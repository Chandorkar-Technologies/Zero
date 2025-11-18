import { useEffect, useRef, useState, useCallback } from 'react';

interface Participant {
  id: string;
  userId?: string;
  name: string;
  email?: string;
  isGuest: boolean;
  joinedAt: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  stream?: MediaStream;
}

interface ChatMessage {
  id: string;
  participantId: string;
  participantName: string;
  message: string;
  timestamp: number;
  type: 'text' | 'file' | 'emoji';
}

export function useMeetingRoom(wsUrl: string, participantId: string) {
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Initialize local media stream
  const initializeLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      return null;
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback(
    (remoteParticipantId: string): RTCPeerConnection => {
      const configuration: RTCConfiguration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      };

      const pc = new RTCPeerConnection(configuration);

      // Add local stream tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Handle incoming stream
      pc.ontrack = (event) => {
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === remoteParticipantId ? { ...p, stream: event.streams[0] } : p
          )
        );
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current) {
          wsRef.current.send(
            JSON.stringify({
              type: 'webrtc-signal',
              signal: {
                type: 'ice-candidate',
                from: participantId,
                to: remoteParticipantId,
                data: event.candidate,
              },
            })
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
      };

      peerConnectionsRef.current.set(remoteParticipantId, pc);
      return pc;
    },
    [participantId]
  );

  // Handle WebRTC signaling
  const handleWebRTCSignal = useCallback(
    async (signal: any) => {
      const { from, to, type, data } = signal;

      if (to !== participantId) return;

      let pc = peerConnectionsRef.current.get(from);
      if (!pc) {
        pc = createPeerConnection(from);
      }

      try {
        if (type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          wsRef.current?.send(
            JSON.stringify({
              type: 'webrtc-signal',
              signal: {
                type: 'answer',
                from: participantId,
                to: from,
                data: answer,
              },
            })
          );
        } else if (type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
        } else if (type === 'ice-candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(data));
        }
      } catch (error) {
        console.error('Error handling WebRTC signal:', error);
      }
    },
    [participantId, createPeerConnection]
  );

  // Send offer to a participant
  const sendOffer = useCallback(
    async (remoteParticipantId: string) => {
      const pc = createPeerConnection(remoteParticipantId);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        wsRef.current?.send(
          JSON.stringify({
            type: 'webrtc-signal',
            signal: {
              type: 'offer',
              from: participantId,
              to: remoteParticipantId,
              data: offer,
            },
          })
        );
      } catch (error) {
        console.error('Error sending offer:', error);
      }
    },
    [participantId, createPeerConnection]
  );

  // Connect to WebSocket
  useEffect(() => {
    const connectWebSocket = async () => {
      // Initialize local stream first
      await initializeLocalStream();

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'init':
            // Initial state received
            setParticipants(data.state.participants);
            setMessages(data.state.messages);
            setIsRecording(data.state.isRecording);

            // Send offers to all existing participants
            data.state.participants.forEach((p: Participant) => {
              if (p.id !== participantId) {
                sendOffer(p.id);
              }
            });
            break;

          case 'participant-joined':
            setParticipants((prev) => [...prev, data.participant]);
            // New participant joined, send them an offer
            sendOffer(data.participant.id);
            break;

          case 'participant-left':
            setParticipants((prev) => prev.filter((p) => p.id !== data.participantId));
            // Clean up peer connection
            const pc = peerConnectionsRef.current.get(data.participantId);
            if (pc) {
              pc.close();
              peerConnectionsRef.current.delete(data.participantId);
            }
            break;

          case 'participant-updated':
            setParticipants((prev) =>
              prev.map((p) => (p.id === data.participantId ? { ...p, ...data.updates } : p))
            );
            break;

          case 'webrtc-signal':
            handleWebRTCSignal(data.signal);
            break;

          case 'chat-message':
            setMessages((prev) => [...prev, data.message]);
            break;

          case 'emoji-reaction':
            // Handle emoji reaction (could show floating emoji)
            console.log('Emoji reaction:', data.emoji, 'from', data.participantId);
            break;

          case 'recording-started':
            setIsRecording(true);
            break;

          case 'recording-stopped':
            setIsRecording(false);
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
      };
    };

    connectWebSocket();

    return () => {
      // Cleanup
      wsRef.current?.close();
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [wsUrl, participantId, initializeLocalStream, sendOffer, handleWebRTCSignal]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);

        wsRef.current?.send(
          JSON.stringify({
            type: 'update-state',
            updates: { audioEnabled: audioTrack.enabled },
          })
        );
      }
    }
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);

        wsRef.current?.send(
          JSON.stringify({
            type: 'update-state',
            updates: { videoEnabled: videoTrack.enabled },
          })
        );
      }
    }
  }, []);

  // Toggle screen sharing
  const toggleScreenShare = useCallback(async () => {
    try {
      if (screenSharing) {
        // Stop screen sharing
        screenStreamRef.current?.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;

        // Switch back to camera
        if (localStreamRef.current) {
          const videoTrack = localStreamRef.current.getVideoTracks()[0];
          peerConnectionsRef.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) {
              sender.replaceTrack(videoTrack);
            }
          });
        }

        setScreenSharing(false);
        wsRef.current?.send(
          JSON.stringify({
            type: 'update-state',
            updates: { screenSharing: false },
          })
        );
      } else {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        // Replace video track in all peer connections
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        // Handle screen share stop
        screenTrack.onended = () => {
          toggleScreenShare();
        };

        setScreenSharing(true);
        wsRef.current?.send(
          JSON.stringify({
            type: 'update-state',
            updates: { screenSharing: true },
          })
        );
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
    }
  }, [screenSharing]);

  // Send chat message
  const sendMessage = useCallback((message: string) => {
    wsRef.current?.send(
      JSON.stringify({
        type: 'chat-message',
        message,
      })
    );
  }, []);

  // Send emoji reaction
  const sendEmoji = useCallback((emoji: string) => {
    wsRef.current?.send(
      JSON.stringify({
        type: 'emoji-reaction',
        emoji,
      })
    );
  }, []);

  // Start/stop recording
  const toggleRecording = useCallback(() => {
    wsRef.current?.send(
      JSON.stringify({
        type: isRecording ? 'stop-recording' : 'start-recording',
      })
    );
  }, [isRecording]);

  return {
    connected,
    participants,
    messages,
    isRecording,
    localStream,
    audioEnabled,
    videoEnabled,
    screenSharing,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendMessage,
    sendEmoji,
    toggleRecording,
  };
}
