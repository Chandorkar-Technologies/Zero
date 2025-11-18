import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, X, Smile, Paperclip, Download, File } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

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

interface MeetingChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onSendEmoji: (emoji: string) => void;
  onSendFile?: (file: File) => void;
  onClose: () => void;
}

export function MeetingChat({ messages, onSendMessage, onSendEmoji, onSendFile, onClose }: MeetingChatProps) {
  const [inputValue, setInputValue] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleEmojiClick = (emoji: string) => {
    onSendEmoji(emoji);
    setShowEmojiPicker(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (max 10MB for meetings)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File too large', {
          description: 'Maximum file size is 10MB',
        });
        return;
      }

      if (onSendFile) {
        onSendFile(file);
        toast.success('File shared', {
          description: `${file.name} has been shared in the chat`,
        });
      }
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const commonEmojis = ['👍', '👏', '😄', '❤️', '🎉', '🔥', '✅', '👋'];

  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold">In-call messages</h3>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No messages yet</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{msg.participantName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                  </span>
                </div>
                {msg.type === 'file' && msg.fileUrl ? (
                  <a
                    href={msg.fileUrl}
                    download={msg.fileName}
                    className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-accent"
                  >
                    <File className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{msg.fileName || 'File'}</p>
                      {msg.fileSize && (
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(msg.fileSize)}
                        </p>
                      )}
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ) : (
                  <p className="text-sm">{msg.message}</p>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Emoji reactions */}
      {showEmojiPicker && (
        <div className="border-t p-3">
          <div className="grid grid-cols-8 gap-2">
            {commonEmojis.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 text-2xl"
                onClick={() => handleEmojiClick(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 p-0"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            <Smile className="h-5 w-5" />
          </Button>

          {onSendFile && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                accept="*/*"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </>
          )}

          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Send a message"
            className="flex-1"
          />

          <Button size="sm" onClick={handleSend} disabled={!inputValue.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
