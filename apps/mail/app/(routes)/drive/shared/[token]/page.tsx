import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  File,
  Folder,
  Download,
  Eye,
  Loader2,
  AlertCircle,
  ArrowLeft,
  HardDrive,
  Clock,
  User,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// File icon based on mimeType
function getFileIcon(mimeType: string, className?: string) {
  const iconClass = cn('h-16 w-16', className);
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return <FileText className={cn(iconClass, 'text-blue-500')} />;
  }
  if (mimeType.includes('sheet') || mimeType.includes('excel')) {
    return <FileSpreadsheet className={cn(iconClass, 'text-green-500')} />;
  }
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return <FileText className={cn(iconClass, 'text-orange-500')} />;
  }
  if (mimeType === 'application/pdf') {
    return <FileText className={cn(iconClass, 'text-red-500')} />;
  }
  if (mimeType.startsWith('image/')) {
    return <FileImage className={cn(iconClass, 'text-purple-500')} />;
  }
  if (mimeType.startsWith('video/')) {
    return <FileVideo className={cn(iconClass, 'text-pink-500')} />;
  }
  if (mimeType.startsWith('audio/')) {
    return <FileAudio className={cn(iconClass, 'text-yellow-500')} />;
  }
  return <File className={cn(iconClass, 'text-gray-500')} />;
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

interface ShareInfo {
  id: string;
  type: 'file' | 'folder';
  accessLevel: string;
  file: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
  } | null;
  folder: {
    id: string;
    name: string;
  } | null;
  owner: {
    name: string;
  } | null;
  createdAt: string;
  expiresAt: string | null;
}

export default function SharedFilePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const backendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    const fetchShareInfo = async () => {
      if (!token) {
        setError('Invalid share link');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`${backendUrl}/api/drive/shared/${token}`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Failed to load shared item');
          setLoading(false);
          return;
        }

        setShareInfo(data);
      } catch (err) {
        console.error('Error fetching share info:', err);
        setError('Failed to load shared item');
      } finally {
        setLoading(false);
      }
    };

    fetchShareInfo();
  }, [token, backendUrl]);

  const handleDownload = () => {
    if (!token) return;
    window.open(`${backendUrl}/api/drive/shared/${token}/download`, '_blank');
  };

  const handlePreview = () => {
    if (!token) return;
    setPreviewUrl(`${backendUrl}/api/drive/shared/${token}/preview`);
    setShowPreview(true);
  };

  const isPreviewable = shareInfo?.file?.mimeType && (
    shareInfo.file.mimeType.startsWith('image/') ||
    shareInfo.file.mimeType === 'application/pdf' ||
    shareInfo.file.mimeType.startsWith('video/')
  );

  // Check if file is editable (documents, spreadsheets, presentations)
  const isEditable = shareInfo?.file?.mimeType && (
    shareInfo.file.mimeType.includes('word') ||
    shareInfo.file.mimeType.includes('document') ||
    shareInfo.file.mimeType.includes('sheet') ||
    shareInfo.file.mimeType.includes('excel') ||
    shareInfo.file.mimeType.includes('presentation') ||
    shareInfo.file.mimeType.includes('powerpoint') ||
    shareInfo.file.mimeType === 'text/plain'
  );

  // Check if user has edit access
  const canEdit = shareInfo?.accessLevel === 'edit';

  const handleEdit = () => {
    if (!token) return;
    navigate(`/drive/shared/${token}/edit`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Loading shared item...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="mt-4 text-2xl font-bold">{error}</h1>
          <p className="mt-2 text-muted-foreground">
            This link may have expired or been removed.
          </p>
          <Button className="mt-6" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  if (!shareInfo) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="container mx-auto flex items-center gap-4">
          <HardDrive className="h-6 w-6" />
          <span className="text-lg font-semibold">Nubo Drive</span>
          <span className="text-sm text-muted-foreground">Shared with you</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        <div className="container mx-auto">
          {/* Preview Modal */}
          {showPreview && previewUrl && shareInfo.file && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
              <div className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-background p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={() => setShowPreview(false)}
                >
                  Close
                </Button>
                <div className="mt-8">
                  {shareInfo.file.mimeType.startsWith('image/') ? (
                    <img
                      src={previewUrl}
                      alt={shareInfo.file.name}
                      className="max-h-[80vh] max-w-full object-contain"
                    />
                  ) : shareInfo.file.mimeType === 'application/pdf' ? (
                    <iframe
                      src={previewUrl}
                      className="h-[80vh] w-[80vw]"
                      title={shareInfo.file.name}
                    />
                  ) : shareInfo.file.mimeType.startsWith('video/') ? (
                    <video
                      src={previewUrl}
                      controls
                      autoPlay={false}
                      className="max-h-[80vh] max-w-full"
                    >
                      Your browser does not support video playback.
                    </video>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* File/Folder Card */}
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <div className="flex flex-col items-center text-center">
              {shareInfo.type === 'file' && shareInfo.file ? (
                <>
                  {getFileIcon(shareInfo.file.mimeType)}
                  <h1 className="mt-4 text-2xl font-bold break-all">
                    {shareInfo.file.name}
                  </h1>
                  <p className="mt-2 text-muted-foreground">
                    {formatSize(shareInfo.file.size)}
                  </p>
                </>
              ) : shareInfo.folder ? (
                <>
                  <Folder className="h-16 w-16 text-blue-500" />
                  <h1 className="mt-4 text-2xl font-bold break-all">
                    {shareInfo.folder.name}
                  </h1>
                  <p className="mt-2 text-muted-foreground">Folder</p>
                </>
              ) : null}

              {/* Metadata */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
                {shareInfo.owner && (
                  <div className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    <span>Shared by {shareInfo.owner.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>Shared on {format(new Date(shareInfo.createdAt), 'MMM d, yyyy')}</span>
                </div>
                {shareInfo.expiresAt && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <Clock className="h-4 w-4" />
                    <span>Expires {format(new Date(shareInfo.expiresAt), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {shareInfo.type === 'file' && (
                <div className="mt-8 flex flex-wrap gap-3">
                  {canEdit && isEditable && (
                    <Button onClick={handleEdit}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {isPreviewable && (
                    <Button variant="outline" onClick={handlePreview}>
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                  )}
                  <Button variant={canEdit && isEditable ? 'outline' : 'default'} onClick={handleDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Info Footer */}
          <div className="mt-8 text-center text-sm text-muted-foreground">
            <p>
              This file was shared with you via{' '}
              <a href="/" className="text-primary hover:underline">
                Nubo Drive
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
