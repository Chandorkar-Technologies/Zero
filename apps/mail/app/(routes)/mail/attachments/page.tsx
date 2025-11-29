import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, FileText, Image, Table, File, Download, Eye } from 'lucide-react';
import { useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Outputs } from '@zero/server/trpc';

type Attachment = Outputs['attachments']['getAllAttachments'][0];

export default function AttachmentsPage() {
  const trpc = useTRPC();
  const [fileType, setFileType] = useState<
    'all' | 'images' | 'documents' | 'spreadsheets' | 'other'
  >('all');
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [previewContent, setPreviewContent] = useState<{
    content: string;
    contentType: string;
    filename: string;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Get all connections
  const { data: connectionsData } = useQuery(trpc.connections.list.queryOptions());
  const connections = connectionsData?.connections;

  const connectionId = connections?.[0]?.id;

  // Get all attachments
  const { data: attachments, isLoading } = useQuery({
    ...trpc.attachments.getAllAttachments.queryOptions({
      connectionId: connectionId || '',
      fileType,
      limit: 100,
    }),
    enabled: !!connectionId,
  });

  // Get attachment stats
  const { data: stats } = useQuery({
    ...trpc.attachments.getAttachmentStats.queryOptions({
      connectionId: connectionId || '',
    }),
    enabled: !!connectionId,
  });

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) {
      return <Image className="h-10 w-10 text-blue-600 dark:text-blue-400" />;
    } else if (mimeType.includes('pdf') || mimeType.includes('document')) {
      return <FileText className="h-10 w-10 text-red-600 dark:text-red-400" />;
    } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return <Table className="h-10 w-10 text-green-600 dark:text-green-400" />;
    } else {
      return <File className="h-10 w-10 text-gray-600 dark:text-gray-400" />;
    }
  };

  const handlePreview = useCallback(async (attachment: Attachment) => {
    if (!connectionId || !attachment.r2Key) {
      return;
    }

    setSelectedAttachment(attachment);
    setIsLoadingPreview(true);
    setPreviewContent(null);

    try {
      const backendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL || '';
      const response = await fetch(
        `${backendUrl}/api/trpc/attachments.getAttachmentContent?input=${encodeURIComponent(
          JSON.stringify({ connectionId, attachmentId: attachment.id })
        )}`,
        { credentials: 'include' }
      );
      const data = await response.json();

      if (data.result?.data) {
        setPreviewContent({
          content: data.result.data.content,
          contentType: data.result.data.contentType,
          filename: data.result.data.filename,
        });
      }
    } catch (error) {
      console.error('Failed to load attachment:', error);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [connectionId]);

  const handleDownload = useCallback(async (attachment: Attachment) => {
    if (!connectionId || !attachment.r2Key) {
      return;
    }

    try {
      const backendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL || '';
      const response = await fetch(
        `${backendUrl}/api/trpc/attachments.getAttachmentContent?input=${encodeURIComponent(
          JSON.stringify({ connectionId, attachmentId: attachment.id })
        )}`,
        { credentials: 'include' }
      );
      const data = await response.json();

      if (data.result?.data) {
        // Convert base64 to blob and download
        const byteCharacters = atob(data.result.data.content);
        const byteArray = Uint8Array.from(byteCharacters, (char) => char.charCodeAt(0));
        const blob = new Blob([byteArray], { type: data.result.data.contentType });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = data.result.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to download attachment:', error);
    }
  }, [connectionId]);

  const closePreview = () => {
    setSelectedAttachment(null);
    setPreviewContent(null);
  };

  const renderPreviewContent = () => {
    if (isLoadingPreview) {
      return (
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (!previewContent) {
      return (
        <div className="flex h-96 flex-col items-center justify-center gap-2 text-muted-foreground">
          <File className="h-16 w-16" />
          <p>Unable to preview this file</p>
        </div>
      );
    }

    const { content, contentType, filename } = previewContent;
    const dataUrl = `data:${contentType};base64,${content}`;

    // Image preview
    if (contentType.startsWith('image/')) {
      return (
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto">
          <img
            src={dataUrl}
            alt={filename}
            className="max-w-full object-contain"
          />
        </div>
      );
    }

    // PDF preview
    if (contentType === 'application/pdf') {
      return (
        <iframe
          src={dataUrl}
          className="h-[70vh] w-full"
          title={filename}
        />
      );
    }

    // Text files
    if (contentType.startsWith('text/') || contentType === 'application/json') {
      const text = atob(content);
      return (
        <pre className="max-h-[70vh] overflow-auto rounded bg-muted p-4 text-sm">
          {text}
        </pre>
      );
    }

    // Other files - show download prompt
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4 text-muted-foreground">
        <File className="h-16 w-16" />
        <p>Preview not available for this file type</p>
        <Button onClick={() => selectedAttachment && handleDownload(selectedAttachment)}>
          <Download className="mr-2 h-4 w-4" />
          Download File
        </Button>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Paperclip className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Email Connection</h2>
          <p className="text-muted-foreground">
            Connect an email account to see attachments
          </p>
        </div>
      </div>
    );
  }

  // Check if using OAuth connection (attachments not available)
  const isOAuthConnection = connections?.[0]?.providerId !== 'imap';

  if (!attachments || attachments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <Paperclip className="h-16 w-16 text-muted-foreground" />
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-semibold">No Attachments</h2>
          <p className="text-muted-foreground mt-2">
            {isOAuthConnection
              ? 'Attachment browsing is currently only available for IMAP connections. For Gmail/Outlook connections, attachments can be viewed within individual emails.'
              : 'No attachments found in your emails'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 sm:p-6">
        <h1 className="mb-2 sm:mb-4 text-xl sm:text-2xl font-semibold">Attachments</h1>
        <p className="mb-3 sm:mb-4 text-sm sm:text-base text-muted-foreground">
          All email attachments in one place
        </p>

        {stats && (
          <div className="mb-3 sm:mb-4 flex gap-3 sm:gap-4 text-xs sm:text-sm">
            <span>Total: {stats.total}</span>
            <span>Size: {formatFileSize(stats.totalSize)}</span>
          </div>
        )}

        <Tabs value={fileType} onValueChange={(v: any) => setFileType(v)}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all" className="text-xs sm:text-sm">
              All
              {stats && <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{stats.total}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="images" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Images</span>
              <span className="sm:hidden">Img</span>
              {stats && stats.images > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{stats.images}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Documents</span>
              <span className="sm:hidden">Docs</span>
              {stats && stats.documents > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{stats.documents}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="spreadsheets" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Spreadsheets</span>
              <span className="sm:hidden">XLS</span>
              {stats && stats.spreadsheets > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{stats.spreadsheets}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="other" className="text-xs sm:text-sm">
              Other
              {stats && stats.other > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{stats.other}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md"
              onClick={() => handlePreview(attachment)}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0">{getFileIcon(attachment.mimeType)}</div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium text-sm" title={attachment.filename}>
                    {attachment.filename}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.size)}
                  </p>

                  {attachment.from && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      From: {attachment.from.name || attachment.from.address}
                    </p>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(attachment.date), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={!attachment.r2Key}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(attachment);
                  }}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!attachment.r2Key}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(attachment);
                  }}
                  title={!attachment.r2Key ? 'Download not available - attachment needs to be re-synced' : 'Download attachment'}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!selectedAttachment} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate pr-4">{selectedAttachment?.filename}</span>
              <div className="flex items-center gap-2">
                {selectedAttachment && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedAttachment.r2Key}
                    onClick={() => handleDownload(selectedAttachment)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          {renderPreviewContent()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
