import { DurableObject } from 'cloudflare:workers';
import type { ZeroEnv } from '../env';

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
}

interface ChatMessage {
  id: string;
  participantId: string;
  participantName: string;
  message: string;
  timestamp: number;
  type: 'text' | 'file' | 'emoji';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
}

interface WebRTCSignal {
  type: 'offer' | 'answer' | 'ice-candidate';
  from: string;
  to: string;
  data: any;
}

interface MeetingState {
  id: string;
  hostId: string;
  participants: Map<string, Participant>;
  messages: ChatMessage[];
  isRecording: boolean;
  startedAt?: number;
  settings: {
    maxParticipants: number;
    allowChat: boolean;
    allowScreenShare: boolean;
    allowFileShare: boolean;
  };
}

export class MeetingRoom extends DurableObject<ZeroEnv> {
  private sessions: Map<WebSocket, string>; // Map of websockets to participant IDs
  private state: MeetingState;

  constructor(ctx: DurableObjectState, env: ZeroEnv) {
    super(ctx, env);
    this.sessions = new Map();
    this.state = {
      id: '',
      hostId: '',
      participants: new Map(),
      messages: [],
      isRecording: false,
      settings: {
        maxParticipants: 50,
        allowChat: true,
        allowScreenShare: true,
        allowFileShare: true,
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrade for real-time communication
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // HTTP API endpoints
    if (path === '/init' && request.method === 'POST') {
      return this.initializeMeeting(request);
    }

    if (path === '/state' && request.method === 'GET') {
      return new Response(JSON.stringify(this.getPublicState()), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/end' && request.method === 'POST') {
      return this.endMeeting(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const participantId = url.searchParams.get('participantId');
    const userId = url.searchParams.get('userId');
    const name = url.searchParams.get('name') || 'Guest';
    const email = url.searchParams.get('email') || undefined;

    if (!participantId) {
      return new Response('Missing participantId', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, participantId);

    // Add participant
    const participant: Participant = {
      id: participantId,
      userId,
      name,
      email,
      isGuest: !userId,
      joinedAt: Date.now(),
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
    };

    this.state.participants.set(participantId, participant);

    // Send current state to new participant
    server.send(
      JSON.stringify({
        type: 'init',
        state: this.getPublicState(),
        participantId,
      }),
    );

    // Broadcast participant joined to others
    this.broadcast(
      {
        type: 'participant-joined',
        participant,
      },
      participantId,
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const participantId = this.sessions.get(ws);
      if (!participantId) return;

      const data = typeof message === 'string' ? JSON.parse(message) : message;

      switch (data.type) {
        case 'webrtc-signal':
          // Forward WebRTC signaling messages
          this.handleWebRTCSignal(data.signal, participantId);
          break;

        case 'chat-message':
          // Handle chat message
          this.handleChatMessage(data.message, participantId);
          break;

        case 'update-state':
          // Update participant state (audio/video/screen share)
          this.updateParticipantState(participantId, data.updates);
          break;

        case 'emoji-reaction':
          // Forward emoji reaction
          this.broadcast({
            type: 'emoji-reaction',
            participantId,
            emoji: data.emoji,
          });
          break;

        case 'start-recording':
          if (this.isHost(participantId)) {
            this.state.isRecording = true;
            this.broadcast({ type: 'recording-started' });
          }
          break;

        case 'stop-recording':
          if (this.isHost(participantId)) {
            this.state.isRecording = false;
            this.broadcast({ type: 'recording-stopped' });
          }
          break;
      }
    } catch (error) {
      console.error('Error handling websocket message:', error);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    const participantId = this.sessions.get(ws);
    if (participantId) {
      this.state.participants.delete(participantId);
      this.sessions.delete(ws);

      // Broadcast participant left
      this.broadcast({
        type: 'participant-left',
        participantId,
      });
    }

    // If no participants left, you could optionally end the meeting
    if (this.state.participants.size === 0) {
      // Optional: Clean up meeting state
    }
  }

  private async initializeMeeting(request: Request): Promise<Response> {
    const data = await request.json<{
      id: string;
      hostId: string;
      settings?: Partial<MeetingState['settings']>;
    }>();

    this.state.id = data.id;
    this.state.hostId = data.hostId;
    this.state.startedAt = Date.now();

    if (data.settings) {
      this.state.settings = { ...this.state.settings, ...data.settings };
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async endMeeting(_request: Request): Promise<Response> {
    // Close all websocket connections
    this.ctx.getWebSockets().forEach((ws) => {
      ws.close(1000, 'Meeting ended');
    });

    // Clear state
    this.sessions.clear();
    this.state.participants.clear();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private handleWebRTCSignal(signal: WebRTCSignal, from: string): void {
    // Find target participant's websocket and send signal
    for (const [ws, participantId] of this.sessions.entries()) {
      if (participantId === signal.to) {
        ws.send(
          JSON.stringify({
            type: 'webrtc-signal',
            signal: {
              ...signal,
              from,
            },
          }),
        );
        break;
      }
    }
  }

  private handleChatMessage(message: string, participantId: string): void {
    if (!this.state.settings.allowChat) return;

    const participant = this.state.participants.get(participantId);
    if (!participant) return;

    const chatMessage: ChatMessage = {
      id: crypto.randomUUID(),
      participantId,
      participantName: participant.name,
      message,
      timestamp: Date.now(),
      type: 'text',
    };

    this.state.messages.push(chatMessage);

    // Broadcast to all participants
    this.broadcast({
      type: 'chat-message',
      message: chatMessage,
    });
  }

  private updateParticipantState(
    participantId: string,
    updates: Partial<Pick<Participant, 'audioEnabled' | 'videoEnabled' | 'screenSharing'>>,
  ): void {
    const participant = this.state.participants.get(participantId);
    if (!participant) return;

    Object.assign(participant, updates);

    this.broadcast({
      type: 'participant-updated',
      participantId,
      updates,
    });
  }

  private broadcast(message: any, excludeParticipant?: string): void {
    const payload = JSON.stringify(message);

    for (const [ws, participantId] of this.sessions.entries()) {
      if (participantId !== excludeParticipant) {
        try {
          ws.send(payload);
        } catch (error) {
          console.error('Error broadcasting to participant:', participantId, error);
        }
      }
    }
  }

  private isHost(participantId: string): boolean {
    return participantId === this.state.hostId || this.state.participants.get(participantId)?.userId === this.state.hostId;
  }

  private getPublicState() {
    return {
      id: this.state.id,
      participants: Array.from(this.state.participants.values()),
      messages: this.state.messages,
      isRecording: this.state.isRecording,
      startedAt: this.state.startedAt,
      settings: this.state.settings,
    };
  }
}
