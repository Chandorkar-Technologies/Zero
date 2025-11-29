import { useState, useCallback, useEffect } from 'react';
import { useTRPC } from '@/providers/query-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HardDrive,
  FolderPlus,
  Upload,
  Grid3X3,
  List,
  Star,
  Trash2,
  MoreVertical,
  File,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  Folder,
  ChevronRight,
  Home,
  Search,
  Download,
  Pencil,
  FolderInput,
  ExternalLink,
  Import,
  Check,
  Loader2,
  ArrowLeft,
  CloudDownload,
  X,
  AlertCircle,
  CheckCircle2,
  Eye,
  Share2,
  Link2,
  Users,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

type ViewMode = 'grid' | 'list';
type FilterMode = 'all' | 'starred' | 'trashed' | 'shared';

// File icon based on category
function getFileIcon(category: string, className?: string) {
  const iconClass = cn('h-8 w-8', className);
  switch (category) {
    case 'document':
      return <FileText className={cn(iconClass, 'text-blue-500')} />;
    case 'spreadsheet':
      return <FileSpreadsheet className={cn(iconClass, 'text-green-500')} />;
    case 'presentation':
      return <FileText className={cn(iconClass, 'text-orange-500')} />;
    case 'pdf':
      return <FileText className={cn(iconClass, 'text-red-500')} />;
    case 'image':
      return <FileImage className={cn(iconClass, 'text-purple-500')} />;
    case 'video':
      return <FileVideo className={cn(iconClass, 'text-pink-500')} />;
    case 'audio':
      return <FileAudio className={cn(iconClass, 'text-yellow-500')} />;
    default:
      return <File className={cn(iconClass, 'text-gray-500')} />;
  }
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export default function DrivePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: 'file' | 'folder' } | null>(null);
  // Move functionality - to be implemented
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isMoveOpen, _setIsMoveOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_moveTarget, _setMoveTarget] = useState<{ id: string; name: string } | null>(null);

  // Import state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<'google_drive' | 'onedrive' | null>(null);
  const [importAccessToken, setImportAccessToken] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isFullDriveImport, setIsFullDriveImport] = useState(false);
  const [importFiles, setImportFiles] = useState<Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    isFolder: boolean;
    modifiedTime: string;
  }>>([]);
  const [selectedImportFiles, setSelectedImportFiles] = useState<Set<string>>(new Set());
  const [importFolderStack, setImportFolderStack] = useState<Array<{ id: string; name: string }>>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [activeImportJob, setActiveImportJob] = useState<{
    jobId: string;
    totalFiles: number;
    processedFiles: number;
    failedFiles: number;
    status: 'processing' | 'completed' | 'failed';
  } | null>(null);

  // Upload state
  const [uploadQueue, setUploadQueue] = useState<Array<{
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'completed' | 'failed';
    error?: string;
  }>>([]);

  // Preview state
  const [previewFile, setPreviewFile] = useState<{
    id: string;
    name: string;
    mimeType: string;
    data?: string;
    url?: string;
    type?: 'image' | 'pdf' | 'video' | 'video_url';
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Share state
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    name: string;
    type: 'file' | 'folder';
  } | null>(null);
  const [shareUsername, setShareUsername] = useState('');
  const [shareAccessLevel, setShareAccessLevel] = useState<'view' | 'edit'>('view');
  const [shareSearchResults, setShareSearchResults] = useState<Array<{
    id: string;
    name: string;
    username: string | null;
    email: string;
  }>>([]);
  const [shareSearching, setShareSearching] = useState(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);

  // Current folder from URL
  const currentFolderId = searchParams.get('folder') || null;

  // Handle OAuth callback when this page loads in a popup
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    // Check if we're in a popup and have an OAuth code
    if (code && window.opener) {
      // Send the code to the opener window
      window.opener.postMessage(
        { type: 'oauth_callback', code, state },
        window.location.origin
      );
      // Close this popup
      window.close();
    }
  }, [searchParams]);

  // Queries
  const { data: contents, isLoading, error } = useQuery(
    trpc.drive.listContents.queryOptions({
      folderId: currentFolderId,
      filter,
      sortBy: 'name',
      sortOrder: 'asc',
    }),
  );

  // Log error for debugging
  if (error) {
    console.error('Drive listContents error:', error);
  }

  const { data: folderData } = useQuery(
    trpc.drive.getFolder.queryOptions(
      { folderId: currentFolderId! },
      { enabled: !!currentFolderId },
    ),
  );

  const { data: stats } = useQuery(trpc.drive.getStorageStats.queryOptions());

  // Query for shared files (only when filter is 'shared')
  const { data: sharedWithMe, isLoading: sharedLoading } = useQuery(
    trpc.drive.getSharedWithMe.queryOptions(undefined, {
      enabled: filter === 'shared',
    }),
  );

  // Mutations
  const createFolderMutation = useMutation(trpc.drive.createFolder.mutationOptions());
  const renameFolderMutation = useMutation(trpc.drive.renameFolder.mutationOptions());
  const deleteFolderMutation = useMutation(trpc.drive.deleteFolder.mutationOptions());
  const renameFileMutation = useMutation(trpc.drive.renameFile.mutationOptions());
  const toggleStarMutation = useMutation(trpc.drive.toggleStar.mutationOptions());
  const trashFileMutation = useMutation(trpc.drive.trashFile.mutationOptions());
  const restoreFileMutation = useMutation(trpc.drive.restoreFile.mutationOptions());
  const deleteFileMutation = useMutation(trpc.drive.deleteFile.mutationOptions());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _moveFileMutation = useMutation(trpc.drive.moveFile.mutationOptions());
  const getDownloadUrlMutation = useMutation(trpc.drive.getDownloadUrl.mutationOptions());
  const getEditorConfigMutation = useMutation(trpc.drive.getEditorConfig.mutationOptions());
  const emptyTrashMutation = useMutation(trpc.drive.emptyTrash.mutationOptions());
  const getPreviewUrlMutation = useMutation(trpc.drive.getPreviewUrl.mutationOptions());
  const createShareMutation = useMutation(trpc.drive.createShare.mutationOptions());

  // Import mutations
  const getGoogleAuthUrlMutation = useMutation(trpc.drive.getGoogleDriveAuthUrl.mutationOptions());
  const exchangeGoogleCodeMutation = useMutation(trpc.drive.exchangeGoogleDriveCode.mutationOptions());
  const listGoogleFilesMutation = useMutation(trpc.drive.listGoogleDriveFiles.mutationOptions());
  const importFromGoogleMutation = useMutation(trpc.drive.importFromGoogleDrive.mutationOptions());
  const importEntireGoogleDriveMutation = useMutation(trpc.drive.importEntireGoogleDrive.mutationOptions());
  const getOneDriveAuthUrlMutation = useMutation(trpc.drive.getOneDriveAuthUrl.mutationOptions());
  const exchangeOneDriveCodeMutation = useMutation(trpc.drive.exchangeOneDriveCode.mutationOptions());
  const listOneDriveFilesMutation = useMutation(trpc.drive.listOneDriveFiles.mutationOptions());
  const importFromOneDriveMutation = useMutation(trpc.drive.importFromOneDrive.mutationOptions());
  const importEntireOneDriveMutation = useMutation(trpc.drive.importEntireOneDrive.mutationOptions());

  // Invalidate queries helper
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['drive'] });
  };

  // Handlers
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      await createFolderMutation.mutateAsync({
        name: newFolderName.trim(),
        parentId: currentFolderId,
      });
      toast.success('Folder created');
      setNewFolderName('');
      setIsCreateFolderOpen(false);
      invalidate();
    } catch {
      toast.error('Failed to create folder');
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTarget.name.trim()) return;

    try {
      if (renameTarget.type === 'folder') {
        await renameFolderMutation.mutateAsync({
          folderId: renameTarget.id,
          name: renameTarget.name.trim(),
        });
      } else {
        await renameFileMutation.mutateAsync({
          fileId: renameTarget.id,
          name: renameTarget.name.trim(),
        });
      }
      toast.success('Renamed successfully');
      setIsRenameOpen(false);
      setRenameTarget(null);
      invalidate();
    } catch {
      toast.error('Failed to rename');
    }
  };

  const handleDelete = async (id: string, type: 'file' | 'folder', permanent = false) => {
    try {
      if (type === 'folder') {
        await deleteFolderMutation.mutateAsync({ folderId: id });
        toast.success('Folder deleted');
      } else {
        if (permanent) {
          await deleteFileMutation.mutateAsync({ fileId: id });
          toast.success('File permanently deleted');
        } else {
          await trashFileMutation.mutateAsync({ fileId: id });
          toast.success('File moved to trash');
        }
      }
      invalidate();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleToggleStar = async (fileId: string) => {
    try {
      const result = await toggleStarMutation.mutateAsync({ fileId });
      toast.success(result.isStarred ? 'Added to starred' : 'Removed from starred');
      invalidate();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleRestore = async (fileId: string) => {
    try {
      await restoreFileMutation.mutateAsync({ fileId });
      toast.success('File restored');
      invalidate();
    } catch {
      toast.error('Failed to restore');
    }
  };

  const handleEmptyTrash = async () => {
    try {
      const result = await emptyTrashMutation.mutateAsync();
      toast.success(`Deleted ${result.deletedCount} files`);
      invalidate();
    } catch {
      toast.error('Failed to empty trash');
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDownload = async (fileId: string, _fileName: string) => {
    try {
      const result = await getDownloadUrlMutation.mutateAsync({ fileId });

      if (result.type === 'base64') {
        // Create download from base64
        const link = document.createElement('a');
        link.href = `data:${result.mimeType};base64,${result.data}`;
        link.download = result.fileName;
        link.click();
      } else {
        // Open download URL
        window.open(result.url, '_blank');
      }
      toast.success('Download started');
    } catch {
      toast.error('Failed to download');
    }
  };

  const handleOpenEditor = async (fileId: string) => {
    try {
      await getEditorConfigMutation.mutateAsync({ fileId });
      // Navigate to editor page
      navigate(`/drive/edit/${fileId}`);
    } catch {
      toast.error('Failed to open editor');
    }
  };

  const handlePreview = async (fileId: string, fileName: string, mimeType: string) => {
    setPreviewLoading(true);
    setPreviewFile({ id: fileId, name: fileName, mimeType });
    try {
      const result = await getPreviewUrlMutation.mutateAsync({ fileId });
      if (result.type === 'video_url') {
        setPreviewFile({ id: fileId, name: fileName, mimeType, url: result.url, type: 'video_url' });
      } else {
        setPreviewFile({ id: fileId, name: fileName, mimeType, data: result.data, type: result.type });
      }
    } catch {
      toast.error('Failed to load preview');
      setPreviewFile(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    setPreviewFile(null);
  };

  const handleOpenShare = (id: string, name: string, type: 'file' | 'folder') => {
    setShareTarget({ id, name, type });
    setShareUsername('');
    setShareAccessLevel('view');
    setShareSearchResults([]);
    setGeneratedShareUrl(null);
    setIsShareOpen(true);
  };

  const handleSearchUsers = async (query: string) => {
    setShareUsername(query);
    if (query.length < 2) {
      setShareSearchResults([]);
      return;
    }
    setShareSearching(true);
    try {
      const results = await trpc.drive.searchUsers.query({ query });
      setShareSearchResults(results);
    } catch {
      setShareSearchResults([]);
    } finally {
      setShareSearching(false);
    }
  };

  const handleCreateShare = async (targetUserId?: string) => {
    if (!shareTarget) return;
    try {
      const result = await createShareMutation.mutateAsync({
        fileId: shareTarget.type === 'file' ? shareTarget.id : undefined,
        folderId: shareTarget.type === 'folder' ? shareTarget.id : undefined,
        shareType: targetUserId ? 'user' : 'link',
        sharedWithUserId: targetUserId,
        accessLevel: shareAccessLevel,
      });
      if (targetUserId) {
        toast.success('Shared successfully');
        setIsShareOpen(false);
        setShareTarget(null);
      } else if (result.shareUrl) {
        setGeneratedShareUrl(result.shareUrl);
        toast.success('Share link created');
      }
    } catch {
      toast.error('Failed to create share');
    }
  };

  const handleCopyShareUrl = async () => {
    if (generatedShareUrl) {
      await navigator.clipboard.writeText(generatedShareUrl);
      toast.success('Link copied to clipboard');
    }
  };

  const handleNavigateToFolder = (folderId: string | null) => {
    if (folderId) {
      setSearchParams({ folder: folderId });
    } else {
      setSearchParams({});
    }
  };

  const handleFileUpload = useCallback(async (files: FileList) => {
    const fileArray = Array.from(files);

    // Add files to upload queue
    const newUploads = fileArray.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'pending' as const,
    }));

    setUploadQueue((prev) => [...prev, ...newUploads]);

    // Process uploads sequentially
    for (const upload of newUploads) {
      // Update status to uploading
      setUploadQueue((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, status: 'uploading' as const } : u))
      );

      const formData = new FormData();
      formData.append('file', upload.file);
      if (currentFolderId) {
        formData.append('folderId', currentFolderId);
      }

      try {
        // Use XMLHttpRequest for progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);
              setUploadQueue((prev) =>
                prev.map((u) => (u.id === upload.id ? { ...u, progress } : u))
              );
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadQueue((prev) =>
                prev.map((u) =>
                  u.id === upload.id ? { ...u, status: 'completed' as const, progress: 100 } : u
                )
              );
              toast.success(`Uploaded ${upload.file.name}`);
              // Immediately refresh the file list after each upload
              invalidate();
              resolve();
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Network error')));
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

          // Use the backend URL for API requests
          const backendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL || '';
          xhr.open('POST', `${backendUrl}/api/drive/upload`);
          xhr.withCredentials = true; // Send cookies for auth
          xhr.send(formData);
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        setUploadQueue((prev) =>
          prev.map((u) =>
            u.id === upload.id ? { ...u, status: 'failed' as const, error: errorMessage } : u
          )
        );
        toast.error(`Failed to upload ${upload.file.name}`);
      }
    }

    // Clear completed uploads after 3 seconds
    setTimeout(() => {
      setUploadQueue((prev) => prev.filter((u) => u.status !== 'completed'));
    }, 3000);

    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  // Import handlers
  const handleStartImport = async (source: 'google_drive' | 'onedrive', fullDrive = false) => {
    setImportSource(source);
    setIsFullDriveImport(fullDrive);
    setIsImportOpen(true);

    const redirectUri = `${window.location.origin}/drive`;

    try {
      const authUrl = source === 'google_drive'
        ? (await getGoogleAuthUrlMutation.mutateAsync({ redirectUri })).url
        : (await getOneDriveAuthUrlMutation.mutateAsync({ redirectUri })).url;

      // Open OAuth popup
      const popupName = source === 'google_drive' ? 'Import from Google Drive' : 'Import from OneDrive';
      const popup = window.open(authUrl, popupName, 'width=600,height=700');

      if (popup) {
        // Listen for message from popup with OAuth code
        const handleMessage = (event: MessageEvent) => {
          // Verify origin for security
          if (event.origin !== window.location.origin) return;

          if (event.data?.type === 'oauth_callback' && event.data?.code) {
            window.removeEventListener('message', handleMessage);
            handleOAuthCallback(source, event.data.code, redirectUri, fullDrive);
          }
        };

        window.addEventListener('message', handleMessage);

        // Also check if popup is closed without completing OAuth
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
          }
        }, 1000);
      }
    } catch {
      toast.error('Failed to start import');
      setIsImportOpen(false);
      setIsFullDriveImport(false);
    }
  };

  const handleOAuthCallback = async (source: 'google_drive' | 'onedrive', code: string, redirectUri: string, fullDrive = false) => {
    setImportLoading(true);
    try {
      let accessToken: string;
      if (source === 'google_drive') {
        const result = await exchangeGoogleCodeMutation.mutateAsync({ code, redirectUri });
        accessToken = result.accessToken;
      } else {
        const result = await exchangeOneDriveCodeMutation.mutateAsync({ code, redirectUri });
        accessToken = result.accessToken;
      }
      setImportAccessToken(accessToken);

      // If full drive import, start it immediately
      if (fullDrive) {
        await handleConfirmFullDriveImport(source, accessToken);
      } else {
        await loadImportFiles(source, accessToken);
      }
    } catch {
      toast.error('Failed to authenticate');
      setIsImportOpen(false);
      setIsFullDriveImport(false);
    } finally {
      setImportLoading(false);
    }
  };

  const handleConfirmFullDriveImport = async (source: 'google_drive' | 'onedrive', accessToken: string) => {
    setIsImporting(true);
    try {
      let result: { jobId: string | null; totalFiles: number };
      if (source === 'google_drive') {
        result = await importEntireGoogleDriveMutation.mutateAsync({
          accessToken,
          targetFolderId: currentFolderId,
        });
      } else {
        result = await importEntireOneDriveMutation.mutateAsync({
          accessToken,
          targetFolderId: currentFolderId,
        });
      }

      if (!result.jobId || result.totalFiles === 0) {
        toast.info('No files found to import');
        setIsImportOpen(false);
        setIsFullDriveImport(false);
        return;
      }

      // Set active import job for progress tracking
      setActiveImportJob({
        jobId: result.jobId,
        totalFiles: result.totalFiles,
        processedFiles: 0,
        failedFiles: 0,
        status: 'processing',
      });

      toast.success(`Importing ${result.totalFiles} files from your ${source === 'google_drive' ? 'Google Drive' : 'OneDrive'}. You'll receive an email when complete.`);

      // Reset import dialog state
      setIsImportOpen(false);
      setIsFullDriveImport(false);
      setImportSource(null);
      setImportAccessToken(null);

      // Poll for job status
      const pollInterval = setInterval(async () => {
        try {
          const job = await trpc.drive.getImportJob.query({ jobId: result.jobId! });
          setActiveImportJob({
            jobId: result.jobId!,
            totalFiles: job.totalFiles,
            processedFiles: job.processedFiles,
            failedFiles: job.failedFiles,
            status: job.status as 'processing' | 'completed' | 'failed',
          });

          if (job.status === 'completed' || job.status === 'failed') {
            clearInterval(pollInterval);
            invalidate();

            if (job.status === 'completed') {
              toast.success(`Successfully imported ${job.processedFiles} file${job.processedFiles > 1 ? 's' : ''}${job.failedFiles > 0 ? ` (${job.failedFiles} failed)` : ''}`);
            } else {
              toast.error(`Import failed. ${job.processedFiles} succeeded, ${job.failedFiles} failed.`);
            }

            // Clear active job after a delay
            setTimeout(() => setActiveImportJob(null), 3000);
          }
        } catch (error) {
          console.error('Failed to poll job status:', error);
          clearInterval(pollInterval);
        }
      }, 2000);

    } catch {
      toast.error('Failed to start import');
      setActiveImportJob(null);
    } finally {
      setIsImporting(false);
    }
  };

  const loadImportFiles = async (source: 'google_drive' | 'onedrive', accessToken: string, folderId?: string) => {
    setImportLoading(true);
    try {
      if (source === 'google_drive') {
        const result = await listGoogleFilesMutation.mutateAsync({ accessToken, folderId });
        setImportFiles(result.files);
      } else {
        const result = await listOneDriveFilesMutation.mutateAsync({ accessToken, folderId });
        setImportFiles(result.files);
      }
    } catch {
      toast.error('Failed to load files');
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportFolderNavigate = async (folder: { id: string; name: string }) => {
    if (!importAccessToken || !importSource) return;
    setImportFolderStack((prev) => [...prev, folder]);
    setSelectedImportFiles(new Set());
    await loadImportFiles(importSource, importAccessToken, folder.id);
  };

  const handleImportFolderBack = async () => {
    if (!importAccessToken || !importSource) return;
    const newStack = [...importFolderStack];
    newStack.pop();
    setImportFolderStack(newStack);
    setSelectedImportFiles(new Set());
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : undefined;
    await loadImportFiles(importSource, importAccessToken, parentId);
  };

  const handleToggleImportFile = (fileId: string) => {
    setSelectedImportFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  const handleSelectAllImport = () => {
    const fileIds = importFiles.filter((f) => !f.isFolder).map((f) => f.id);
    if (selectedImportFiles.size === fileIds.length) {
      setSelectedImportFiles(new Set());
    } else {
      setSelectedImportFiles(new Set(fileIds));
    }
  };

  const handleConfirmImport = async () => {
    if (!importAccessToken || !importSource || selectedImportFiles.size === 0) return;

    setIsImporting(true);
    const totalFiles = selectedImportFiles.size;

    try {
      let jobId: string;
      if (importSource === 'google_drive') {
        const result = await importFromGoogleMutation.mutateAsync({
          accessToken: importAccessToken,
          fileIds: Array.from(selectedImportFiles),
          targetFolderId: currentFolderId,
        });
        jobId = result.jobId;
      } else {
        const result = await importFromOneDriveMutation.mutateAsync({
          accessToken: importAccessToken,
          fileIds: Array.from(selectedImportFiles),
          targetFolderId: currentFolderId,
        });
        jobId = result.jobId;
      }

      // Set active import job for progress tracking
      setActiveImportJob({
        jobId,
        totalFiles,
        processedFiles: 0,
        failedFiles: 0,
        status: 'processing',
      });

      toast.success(`Importing ${totalFiles} file${totalFiles > 1 ? 's' : ''}...`);

      // Reset import dialog state
      setIsImportOpen(false);
      setImportSource(null);
      setImportAccessToken(null);
      setImportFiles([]);
      setSelectedImportFiles(new Set());
      setImportFolderStack([]);

      // Poll for job status
      const pollInterval = setInterval(async () => {
        try {
          const job = await trpc.drive.getImportJob.query({ jobId });
          setActiveImportJob({
            jobId,
            totalFiles: job.totalFiles,
            processedFiles: job.processedFiles,
            failedFiles: job.failedFiles,
            status: job.status as 'processing' | 'completed' | 'failed',
          });

          if (job.status === 'completed' || job.status === 'failed') {
            clearInterval(pollInterval);
            invalidate();

            if (job.status === 'completed') {
              toast.success(`Successfully imported ${job.processedFiles} file${job.processedFiles > 1 ? 's' : ''}${job.failedFiles > 0 ? ` (${job.failedFiles} failed)` : ''}`);
            } else {
              toast.error(`Import failed. ${job.processedFiles} succeeded, ${job.failedFiles} failed.`);
            }

            // Clear active job after a delay
            setTimeout(() => setActiveImportJob(null), 3000);
          }
        } catch (error) {
          console.error('Failed to poll job status:', error);
          clearInterval(pollInterval);
        }
      }, 1000);

    } catch {
      toast.error('Failed to start import');
      setActiveImportJob(null);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloseImport = () => {
    setIsImportOpen(false);
    setImportSource(null);
    setImportAccessToken(null);
    setImportFiles([]);
    setSelectedImportFiles(new Set());
    setImportFolderStack([]);
  };

  // Filter contents by search
  const filteredFolders = contents?.folders.filter(
    (f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredFiles = contents?.files.filter(
    (f) => f.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Breadcrumbs
  const breadcrumbs = folderData?.breadcrumbs || [];

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/mail/inbox')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Inbox
            </Button>
            <div className="flex items-center gap-2">
              <HardDrive className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Nubo Drive</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Import className="mr-2 h-4 w-4" />
                  Import
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleStartImport('google_drive')}>
                  <CloudDownload className="mr-2 h-4 w-4" />
                  Select from Google Drive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStartImport('google_drive', true)}>
                  <HardDrive className="mr-2 h-4 w-4" />
                  Import Entire Google Drive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleStartImport('onedrive')}>
                  <CloudDownload className="mr-2 h-4 w-4" />
                  Select from OneDrive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStartImport('onedrive', true)}>
                  <HardDrive className="mr-2 h-4 w-4" />
                  Import Entire OneDrive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setIsCreateFolderOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
            <Button asChild>
              <label>
                <Upload className="mr-2 h-4 w-4" />
                Upload
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                />
              </label>
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-4 flex items-center justify-between">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-sm">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleNavigateToFolder(null)}
              className={cn(!currentFolderId && 'font-semibold')}
            >
              <Home className="mr-1 h-4 w-4" />
              My Drive
            </Button>
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.id} className="flex items-center">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleNavigateToFolder(crumb.id)}
                  className={cn(index === breadcrumbs.length - 1 && 'font-semibold')}
                >
                  {crumb.name}
                </Button>
              </div>
            ))}
          </div>

          {/* Search and View Toggle */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-8"
              />
            </div>
            <div className="flex rounded-lg border">
              <Button
                variant={filter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter('all')}
              >
                All
              </Button>
              <Button
                variant={filter === 'starred' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter('starred')}
              >
                <Star className="mr-1 h-4 w-4" />
                Starred
              </Button>
              <Button
                variant={filter === 'trashed' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter('trashed')}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Trash
              </Button>
              <Button
                variant={filter === 'shared' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter('shared')}
              >
                <Users className="mr-1 h-4 w-4" />
                Shared
              </Button>
            </div>
            <div className="flex rounded-lg border">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Import Progress Bar */}
      {activeImportJob && (
        <div className="border-b bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {activeImportJob.status === 'processing' ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : activeImportJob.status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm font-medium">
                {activeImportJob.status === 'processing'
                  ? 'Importing files...'
                  : activeImportJob.status === 'completed'
                    ? 'Import complete!'
                    : 'Import failed'}
              </span>
            </div>
            <div className="flex-1">
              <Progress
                value={(activeImportJob.processedFiles + activeImportJob.failedFiles) / activeImportJob.totalFiles * 100}
                className="h-2"
              />
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {activeImportJob.processedFiles + activeImportJob.failedFiles} / {activeImportJob.totalFiles}
              </span>
              {activeImportJob.failedFiles > 0 && (
                <span className="text-destructive">
                  ({activeImportJob.failedFiles} failed)
                </span>
              )}
              {activeImportJob.status === 'processing' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setActiveImportJob(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Shared with Me View */}
        {filter === 'shared' ? (
          sharedLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading shared files...</div>
            </div>
          ) : !sharedWithMe || sharedWithMe.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Users className="mb-4 h-16 w-16 text-muted-foreground" />
              <h3 className="text-lg font-semibold">No shared files</h3>
              <p className="text-muted-foreground mb-4">
                Files shared with you will appear here
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {sharedWithMe.map((item) => {
                const isPdf = item.file?.mimeType === 'application/pdf';
                const isImage = item.file?.mimeType?.startsWith('image/') ?? false;
                const isVideo = item.file?.mimeType?.startsWith('video/') ?? false;
                const isEditable = item.file?.mimeType?.includes('document') ||
                  item.file?.mimeType?.includes('spreadsheet') ||
                  item.file?.mimeType?.includes('presentation') || false;
                const category = isPdf ? 'pdf' : isImage ? 'image' : isVideo ? 'video' :
                  item.file?.mimeType?.includes('document') ? 'document' :
                  item.file?.mimeType?.includes('spreadsheet') ? 'spreadsheet' :
                  item.file?.mimeType?.includes('presentation') ? 'presentation' : 'other';

                return (
                  <div
                    key={item.share.id}
                    className="group relative flex flex-col items-center rounded-lg border p-4 hover:bg-accent cursor-pointer"
                    onDoubleClick={() => {
                      if (item.file) {
                        if (isPdf || isImage || isVideo) {
                          handlePreview(item.file.id, item.file.name, item.file.mimeType);
                        } else if (isEditable && item.share.accessLevel === 'edit') {
                          handleOpenEditor(item.file.id);
                        } else {
                          handleDownload(item.file.id, item.file.name);
                        }
                      } else if (item.folder) {
                        handleNavigateToFolder(item.folder.id);
                      }
                    }}
                  >
                    {item.file ? (
                      <>
                        {getFileIcon(category)}
                        <span className="mt-2 text-sm font-medium text-center truncate w-full">
                          {item.file.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatSize(item.file.size)}
                        </span>
                      </>
                    ) : item.folder ? (
                      <>
                        <Folder className="h-12 w-12 text-blue-500" />
                        <span className="mt-2 text-sm font-medium text-center truncate w-full">
                          {item.folder.name}
                        </span>
                      </>
                    ) : null}
                    <span className="text-xs text-muted-foreground mt-1">
                      from {item.owner?.name || 'Unknown'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium">Name</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">Owner</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">Size</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">Shared On</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedWithMe.map((item) => {
                    const isPdf = item.file?.mimeType === 'application/pdf';
                    const isImage = item.file?.mimeType?.startsWith('image/') ?? false;
                    const isVideo = item.file?.mimeType?.startsWith('video/') ?? false;
                    const isEditable = item.file?.mimeType?.includes('document') ||
                      item.file?.mimeType?.includes('spreadsheet') ||
                      item.file?.mimeType?.includes('presentation') || false;
                    const category = isPdf ? 'pdf' : isImage ? 'image' : isVideo ? 'video' :
                      item.file?.mimeType?.includes('document') ? 'document' :
                      item.file?.mimeType?.includes('spreadsheet') ? 'spreadsheet' :
                      item.file?.mimeType?.includes('presentation') ? 'presentation' : 'other';

                    return (
                      <tr
                        key={item.share.id}
                        className="border-t hover:bg-accent cursor-pointer"
                        onDoubleClick={() => {
                          if (item.file) {
                            if (isPdf || isImage || isVideo) {
                              handlePreview(item.file.id, item.file.name, item.file.mimeType);
                            } else if (isEditable && item.share.accessLevel === 'edit') {
                              handleOpenEditor(item.file.id);
                            } else {
                              handleDownload(item.file.id, item.file.name);
                            }
                          } else if (item.folder) {
                            handleNavigateToFolder(item.folder.id);
                          }
                        }}
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {item.file ? (
                              getFileIcon(category, 'h-5 w-5')
                            ) : (
                              <Folder className="h-5 w-5 text-blue-500" />
                            )}
                            <span className="font-medium">
                              {item.file?.name || item.folder?.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">
                          {item.owner?.name || 'Unknown'}
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">
                          {item.file ? formatSize(item.file.size) : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">
                          {format(new Date(item.share.createdAt), 'MMM d, yyyy')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <HardDrive className="mb-4 h-16 w-16 text-muted-foreground" />
            <h3 className="text-lg font-semibold">
              {filter === 'trashed' ? 'Trash is empty' : filter === 'starred' ? 'No starred files' : 'No files yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {filter === 'all' && 'Upload files or create folders to get started'}
            </p>
            {filter === 'trashed' && contents?.files && contents.files.length > 0 && (
              <Button variant="destructive" onClick={handleEmptyTrash}>
                Empty Trash
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {/* Folders */}
            {filteredFolders.map((folder) => (
              <div
                key={folder.id}
                className="group relative flex flex-col items-center rounded-lg border p-4 hover:bg-accent cursor-pointer"
                onDoubleClick={() => handleNavigateToFolder(folder.id)}
              >
                <Folder className="h-12 w-12 text-blue-500" />
                <span className="mt-2 text-sm font-medium text-center truncate w-full">
                  {folder.name}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleNavigateToFolder(folder.id)}>
                      <FolderInput className="mr-2 h-4 w-4" />
                      Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setRenameTarget({ id: folder.id, name: folder.name, type: 'folder' });
                      setIsRenameOpen(true);
                    }}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleDelete(folder.id, 'folder')}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {/* Files */}
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className="group relative flex flex-col items-center rounded-lg border p-4 hover:bg-accent cursor-pointer"
                onDoubleClick={() => {
                  // PDF, images, and videos open in preview; editable files open in editor; others download
                  if (file.isPdf || file.isImage || file.isVideo) {
                    handlePreview(file.id, file.name, file.mimeType);
                  } else if (file.isEditable) {
                    handleOpenEditor(file.id);
                  } else {
                    handleDownload(file.id, file.name);
                  }
                }}
              >
                {file.isStarred && (
                  <Star className="absolute left-1 top-1 h-4 w-4 fill-yellow-500 text-yellow-500" />
                )}
                {getFileIcon(file.category)}
                <span className="mt-2 text-sm font-medium text-center truncate w-full">
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatSize(file.size)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {filter === 'trashed' ? (
                      <>
                        <DropdownMenuItem onClick={() => handleRestore(file.id)}>
                          Restore
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(file.id, 'file', true)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Permanently
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <>
                        {/* Preview option for PDFs and images */}
                        {(file.isPdf || file.isImage) && (
                          <DropdownMenuItem onClick={() => handlePreview(file.id, file.name, file.mimeType)}>
                            <Eye className="mr-2 h-4 w-4" />
                            Preview
                          </DropdownMenuItem>
                        )}
                        {/* Editor option for editable files (not PDFs) */}
                        {file.isEditable && (
                          <DropdownMenuItem onClick={() => handleOpenEditor(file.id)}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open in Editor
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleDownload(file.id, file.name)}>
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleOpenShare(file.id, file.name, 'file')}>
                          <Share2 className="mr-2 h-4 w-4" />
                          Share
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleStar(file.id)}>
                          <Star className={cn('mr-2 h-4 w-4', file.isStarred && 'fill-yellow-500')} />
                          {file.isStarred ? 'Unstar' : 'Star'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          setRenameTarget({ id: file.id, name: file.name, type: 'file' });
                          setIsRenameOpen(true);
                        }}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(file.id, 'file')}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Move to Trash
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium">Name</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Size</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Modified</th>
                  <th className="px-4 py-2 text-right text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFolders.map((folder) => (
                  <tr
                    key={folder.id}
                    className="border-t hover:bg-accent cursor-pointer"
                    onDoubleClick={() => handleNavigateToFolder(folder.id)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Folder className="h-5 w-5 text-blue-500" />
                        <span className="font-medium">{folder.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">—</td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {format(new Date(folder.updatedAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => handleNavigateToFolder(folder.id)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            setRenameTarget({ id: folder.id, name: folder.name, type: 'folder' });
                            setIsRenameOpen(true);
                          }}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(folder.id, 'folder')}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filteredFiles.map((file) => (
                  <tr
                    key={file.id}
                    className="border-t hover:bg-accent cursor-pointer"
                    onDoubleClick={() => {
                      // PDF, images, and videos open in preview; editable files open in editor; others download
                      if (file.isPdf || file.isImage || file.isVideo) {
                        handlePreview(file.id, file.name, file.mimeType);
                      } else if (file.isEditable) {
                        handleOpenEditor(file.id);
                      } else {
                        handleDownload(file.id, file.name);
                      }
                    }}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {file.isStarred && (
                          <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                        )}
                        {getFileIcon(file.category, 'h-5 w-5')}
                        <span className="font-medium">{file.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {formatSize(file.size)}
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {format(new Date(file.updatedAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {filter === 'trashed' ? (
                            <>
                              <DropdownMenuItem onClick={() => handleRestore(file.id)}>
                                Restore
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(file.id, 'file', true)}
                              >
                                Delete Permanently
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              {/* Preview option for PDFs and images */}
                              {(file.isPdf || file.isImage) && (
                                <DropdownMenuItem onClick={() => handlePreview(file.id, file.name, file.mimeType)}>
                                  <Eye className="mr-2 h-4 w-4" />
                                  Preview
                                </DropdownMenuItem>
                              )}
                              {/* Editor option for editable files (not PDFs) */}
                              {file.isEditable && (
                                <DropdownMenuItem onClick={() => handleOpenEditor(file.id)}>
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Open in Editor
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleDownload(file.id, file.name)}>
                                <Download className="mr-2 h-4 w-4" />
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleOpenShare(file.id, file.name, 'file')}>
                                <Share2 className="mr-2 h-4 w-4" />
                                Share
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleStar(file.id)}>
                                <Star className={cn('mr-2 h-4 w-4', file.isStarred && 'fill-yellow-500')} />
                                {file.isStarred ? 'Unstar' : 'Star'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setRenameTarget({ id: file.id, name: file.name, type: 'file' });
                                setIsRenameOpen(true);
                              }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(file.id, 'file')}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Move to Trash
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Storage Stats Footer */}
      {stats && (
        <div className="border-t p-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{stats.totalFiles} files</span>
            <span>{formatSize(stats.totalSize)} used</span>
          </div>
        </div>
      )}

      {/* Create Folder Dialog */}
      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder.</DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Enter a new name.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameTarget?.name || ''}
            onChange={(e) => setRenameTarget(prev => prev ? { ...prev, name: e.target.value } : null)}
            placeholder="Name"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameTarget?.name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={(open) => !open && handleCloseImport()}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Import from {importSource === 'google_drive' ? 'Google Drive' : 'OneDrive'}
            </DialogTitle>
            <DialogDescription>
              Select files to import to your Nubo Drive.
            </DialogDescription>
          </DialogHeader>

          {/* Import content */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {importLoading && !importAccessToken ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Connecting...</span>
              </div>
            ) : importAccessToken ? (
              <>
                {/* Breadcrumb navigation */}
                <div className="flex items-center gap-1 text-sm mb-4 px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImportFolderStack([]);
                      setSelectedImportFiles(new Set());
                      if (importAccessToken && importSource) {
                        loadImportFiles(importSource, importAccessToken);
                      }
                    }}
                    className={cn(importFolderStack.length === 0 && 'font-semibold')}
                  >
                    <Home className="mr-1 h-4 w-4" />
                    Root
                  </Button>
                  {importFolderStack.map((folder, index) => (
                    <div key={folder.id} className="flex items-center">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const newStack = importFolderStack.slice(0, index + 1);
                          setImportFolderStack(newStack);
                          setSelectedImportFiles(new Set());
                          if (importAccessToken && importSource) {
                            await loadImportFiles(importSource, importAccessToken, folder.id);
                          }
                        }}
                        className={cn(index === importFolderStack.length - 1 && 'font-semibold')}
                      >
                        {folder.name}
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Back button */}
                {importFolderStack.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleImportFolderBack}
                    className="mb-2 w-fit"
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                )}

                {/* File list */}
                <div className="flex-1 overflow-auto border rounded-lg">
                  {importLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : importFiles.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      No files found
                    </div>
                  ) : (
                    <div className="divide-y">
                      {/* Select all header */}
                      <div
                        className="flex items-center gap-3 px-4 py-2 bg-muted/50 cursor-pointer hover:bg-muted"
                        onClick={handleSelectAllImport}
                      >
                        <div
                          className={cn(
                            'h-4 w-4 rounded border flex items-center justify-center',
                            selectedImportFiles.size > 0 && selectedImportFiles.size === importFiles.filter(f => !f.isFolder).length
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-input',
                          )}
                        >
                          {selectedImportFiles.size > 0 && selectedImportFiles.size === importFiles.filter(f => !f.isFolder).length && (
                            <Check className="h-3 w-3" />
                          )}
                        </div>
                        <span className="text-sm font-medium">
                          {selectedImportFiles.size > 0
                            ? `${selectedImportFiles.size} selected`
                            : 'Select all files'}
                        </span>
                      </div>

                      {/* Files */}
                      {importFiles.map((file) => (
                        <div
                          key={file.id}
                          className={cn(
                            'flex items-center gap-3 px-4 py-2 hover:bg-accent cursor-pointer',
                            selectedImportFiles.has(file.id) && 'bg-accent',
                          )}
                          onClick={() => {
                            if (file.isFolder) {
                              handleImportFolderNavigate({ id: file.id, name: file.name });
                            } else {
                              handleToggleImportFile(file.id);
                            }
                          }}
                        >
                          {!file.isFolder && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleImportFile(file.id);
                              }}
                              className={cn(
                                'h-4 w-4 rounded border flex items-center justify-center',
                                selectedImportFiles.has(file.id)
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-input',
                              )}
                            >
                              {selectedImportFiles.has(file.id) && <Check className="h-3 w-3" />}
                            </button>
                          )}
                          {file.isFolder ? (
                            <Folder className="h-5 w-5 text-blue-500" />
                          ) : (
                            getFileIcon(
                              file.mimeType.includes('word') || file.mimeType.includes('document')
                                ? 'document'
                                : file.mimeType.includes('sheet') || file.mimeType.includes('excel')
                                  ? 'spreadsheet'
                                  : file.mimeType.includes('presentation') || file.mimeType.includes('powerpoint')
                                    ? 'presentation'
                                    : file.mimeType === 'application/pdf'
                                      ? 'pdf'
                                      : file.mimeType.startsWith('image/')
                                        ? 'image'
                                        : 'other',
                              'h-5 w-5',
                            )
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{file.name}</div>
                            {!file.isFolder && (
                              <div className="text-xs text-muted-foreground">
                                {formatSize(file.size)} • {format(new Date(file.modifiedTime), 'MMM d, yyyy')}
                              </div>
                            )}
                          </div>
                          {file.isFolder && (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12">
                <span className="text-muted-foreground">Waiting for authentication...</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseImport}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={selectedImportFiles.size === 0 || isImporting}
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Import className="mr-2 h-4 w-4" />
                  Import {selectedImportFiles.size > 0 ? `(${selectedImportFiles.size})` : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => handleClosePreview()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {previewFile?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto bg-muted/30 rounded-lg">
            {previewLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading preview...</span>
              </div>
            ) : previewFile?.data || previewFile?.url ? (
              previewFile.type === 'image' || previewFile.mimeType.startsWith('image/') ? (
                <div className="flex items-center justify-center p-4">
                  <img
                    src={`data:${previewFile.mimeType};base64,${previewFile.data}`}
                    alt={previewFile.name}
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                </div>
              ) : previewFile.type === 'pdf' || previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={`data:application/pdf;base64,${previewFile.data}`}
                  className="w-full h-[70vh]"
                  title={previewFile.name}
                />
              ) : previewFile.type === 'video' ? (
                <div className="flex items-center justify-center p-4">
                  <video
                    controls
                    autoPlay={false}
                    className="max-w-full max-h-[70vh]"
                    src={`data:${previewFile.mimeType};base64,${previewFile.data}`}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              ) : previewFile.type === 'video_url' && previewFile.url ? (
                <div className="flex items-center justify-center p-4">
                  <video
                    controls
                    autoPlay={false}
                    className="max-w-full max-h-[70vh]"
                    src={previewFile.url}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              ) : (
                <div className="flex items-center justify-center py-24 text-muted-foreground">
                  Preview not available for this file type
                </div>
              )
            ) : (
              <div className="flex items-center justify-center py-24 text-muted-foreground">
                Failed to load preview
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClosePreview}>
              Close
            </Button>
            {previewFile && (
              <Button onClick={() => handleDownload(previewFile.id, previewFile.name)}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share "{shareTarget?.name}"
            </DialogTitle>
            <DialogDescription>
              Share this {shareTarget?.type} with other Nubo users or create a link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Search users */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Share with user</label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by username or email..."
                  value={shareUsername}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  className="pl-10"
                />
              </div>
              {/* Search results */}
              {shareSearchResults.length > 0 && (
                <div className="border rounded-lg divide-y max-h-40 overflow-auto">
                  {shareSearchResults.map((user) => (
                    <button
                      key={user.id}
                      className="w-full px-3 py-2 text-left hover:bg-accent flex items-center justify-between"
                      onClick={() => handleCreateShare(user.id)}
                    >
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {user.username ? `@${user.username}` : user.email}
                        </div>
                      </div>
                      <Share2 className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
              {shareSearching && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </div>
              )}
            </div>

            {/* Access level */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Access level</label>
              <div className="flex gap-2">
                <Button
                  variant={shareAccessLevel === 'view' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShareAccessLevel('view')}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View only
                </Button>
                <Button
                  variant={shareAccessLevel === 'edit' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShareAccessLevel('edit')}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Can edit
                </Button>
              </div>
            </div>

            {/* Create link or show generated link */}
            <div className="pt-4 border-t">
              {generatedShareUrl ? (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-green-600">Link created!</label>
                  <div className="flex gap-2">
                    <Input
                      value={generatedShareUrl}
                      readOnly
                      className="flex-1 text-sm"
                    />
                    <Button
                      variant="outline"
                      onClick={handleCopyShareUrl}
                    >
                      Copy
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setGeneratedShareUrl(null)}
                  >
                    Create another link
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleCreateShare()}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Create shareable link
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Progress Panel */}
      {uploadQueue.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-96 rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">
              Uploading {uploadQueue.filter((u) => u.status === 'uploading' || u.status === 'pending').length} file(s)
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setUploadQueue([])}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-64 overflow-auto">
            {uploadQueue.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
                <div className="flex-shrink-0">
                  {upload.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : upload.status === 'failed' ? (
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  ) : upload.status === 'uploading' ? (
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  ) : (
                    <File className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.file.name}</p>
                  {upload.status === 'uploading' && (
                    <Progress value={upload.progress} className="h-1 mt-1" />
                  )}
                  {upload.status === 'failed' && (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-red-500">{upload.error}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-xs"
                        onClick={() => {
                          // Remove the failed upload and re-add it
                          setUploadQueue((prev) => prev.filter((u) => u.id !== upload.id));
                          const dt = new DataTransfer();
                          dt.items.add(upload.file);
                          handleFileUpload(dt.files);
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  {upload.status === 'completed' && (
                    <p className="text-xs text-green-500">Completed</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-xs text-muted-foreground">
                  {upload.status === 'uploading' && `${upload.progress}%`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
