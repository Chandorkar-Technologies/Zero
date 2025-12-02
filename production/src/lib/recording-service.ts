import type { R2Bucket } from '@cloudflare/workers-types';

export interface RecordingChunk {
  participantId: string;
  timestamp: number;
  data: ArrayBuffer;
  mimeType: string;
}

export class RecordingService {
  private bucket: R2Bucket;
  private recordingId: string;
  private chunks: RecordingChunk[] = [];
  private isRecording: boolean = false;

  constructor(bucket: R2Bucket, recordingId: string) {
    this.bucket = bucket;
    this.recordingId = recordingId;
  }

  startRecording() {
    this.isRecording = true;
    this.chunks = [];
  }

  addChunk(chunk: RecordingChunk) {
    if (!this.isRecording) return;
    this.chunks.push(chunk);
  }

  async stopRecording(): Promise<{ url: string; duration: number; size: number }> {
    if (!this.isRecording || this.chunks.length === 0) {
      throw new Error('No recording in progress');
    }

    this.isRecording = false;

    // Merge all chunks
    const totalSize = this.chunks.reduce((acc, chunk) => acc + chunk.data.byteLength, 0);
    const mergedBuffer = new ArrayBuffer(totalSize);
    const mergedView = new Uint8Array(mergedBuffer);

    let offset = 0;
    for (const chunk of this.chunks) {
      mergedView.set(new Uint8Array(chunk.data), offset);
      offset += chunk.data.byteLength;
    }

    // Calculate duration (timestamp of last chunk - first chunk)
    const duration = this.chunks.length > 0
      ? (this.chunks[this.chunks.length - 1].timestamp - this.chunks[0].timestamp) / 1000
      : 0;

    // Upload to R2
    const key = `recordings/${this.recordingId}.webm`;
    await this.bucket.put(key, mergedBuffer, {
      httpMetadata: {
        contentType: this.chunks[0]?.mimeType || 'video/webm',
      },
      customMetadata: {
        duration: duration.toString(),
        recordingId: this.recordingId,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Generate public URL (you may need to configure R2 public access)
    const url = `https://recordings.nubo.email/${key}`;

    return {
      url,
      duration,
      size: totalSize,
    };
  }

  async getRecording(recordingId: string): Promise<ReadableStream | null> {
    const key = `recordings/${recordingId}.webm`;
    const object = await this.bucket.get(key);

    if (!object) {
      return null;
    }

    return object.body;
  }

  async deleteRecording(recordingId: string): Promise<void> {
    const key = `recordings/${recordingId}.webm`;
    await this.bucket.delete(key);
  }

  async listRecordings(prefix: string = 'recordings/'): Promise<Array<{
    key: string;
    size: number;
    uploaded: Date;
  }>> {
    const listed = await this.bucket.list({ prefix });

    return listed.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
    }));
  }
}
