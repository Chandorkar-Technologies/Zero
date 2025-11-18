import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, FileText, Image, Table, File, Download, Eye } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import type { Outputs } from '@zero/server/trpc';

type Attachment = Outputs['attachments']['getAllAttachments'][0];

export default function AttachmentsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [fileType, setFileType] = useState<
    'all' | 'images' | 'documents' | 'spreadsheets' | 'other'
  >('all');

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

  const handleAttachmentClick = (attachment: Attachment) => {
    navigate(`/mail/inbox?threadId=${attachment.threadId}`);
  };

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

  if (!attachments || attachments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Paperclip className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Attachments</h2>
          <p className="text-muted-foreground">No attachments found in your emails</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-6">
        <h1 className="mb-4 text-2xl font-semibold">Attachments</h1>
        <p className="mb-4 text-muted-foreground">
          All email attachments in one place
        </p>

        {stats && (
          <div className="mb-4 flex gap-4 text-sm">
            <span>Total: {stats.total}</span>
            <span>Size: {formatFileSize(stats.totalSize)}</span>
          </div>
        )}

        <Tabs value={fileType} onValueChange={(v: any) => setFileType(v)}>
          <TabsList>
            <TabsTrigger value="all">
              All
              {stats && <Badge variant="secondary" className="ml-2">{stats.total}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="images">
              Images
              {stats && stats.images > 0 && (
                <Badge variant="secondary" className="ml-2">{stats.images}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documents
              {stats && stats.documents > 0 && (
                <Badge variant="secondary" className="ml-2">{stats.documents}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="spreadsheets">
              Spreadsheets
              {stats && stats.spreadsheets > 0 && (
                <Badge variant="secondary" className="ml-2">{stats.spreadsheets}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="other">
              Other
              {stats && stats.other > 0 && (
                <Badge variant="secondary" className="ml-2">{stats.other}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md"
              onClick={() => handleAttachmentClick(attachment)}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    // View attachment - navigate to thread
                    handleAttachmentClick(attachment);
                  }}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Download functionality would go here
                    // This requires calling the Gmail API to download the attachment
                  }}
                  title="Download attachment"
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
