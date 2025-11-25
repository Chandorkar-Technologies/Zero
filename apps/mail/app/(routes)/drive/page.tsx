import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

type ViewMode = 'grid' | 'list';
type FilterMode = 'all' | 'starred' | 'trashed';

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

  // Current folder from URL
  const currentFolderId = searchParams.get('folder') || null;

  // Queries
  const { data: contents, isLoading } = useQuery(
    trpc.drive.listContents.queryOptions({
      folderId: currentFolderId,
      filter,
      sortBy: 'name',
      sortOrder: 'asc',
    }),
  );

  const { data: folderData } = useQuery(
    trpc.drive.getFolder.queryOptions({ folderId: currentFolderId! }),
    { enabled: !!currentFolderId },
  );

  const { data: stats } = useQuery(trpc.drive.getStorageStats.queryOptions());

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

  // Import mutations
  const getGoogleAuthUrlMutation = useMutation(trpc.drive.getGoogleDriveAuthUrl.mutationOptions());
  const exchangeGoogleCodeMutation = useMutation(trpc.drive.exchangeGoogleDriveCode.mutationOptions());
  const listGoogleFilesMutation = useMutation(trpc.drive.listGoogleDriveFiles.mutationOptions());
  const importFromGoogleMutation = useMutation(trpc.drive.importFromGoogleDrive.mutationOptions());
  const getOneDriveAuthUrlMutation = useMutation(trpc.drive.getOneDriveAuthUrl.mutationOptions());
  const exchangeOneDriveCodeMutation = useMutation(trpc.drive.exchangeOneDriveCode.mutationOptions());
  const listOneDriveFilesMutation = useMutation(trpc.drive.listOneDriveFiles.mutationOptions());
  const importFromOneDriveMutation = useMutation(trpc.drive.importFromOneDrive.mutationOptions());

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

  const handleNavigateToFolder = (folderId: string | null) => {
    if (folderId) {
      setSearchParams({ folder: folderId });
    } else {
      setSearchParams({});
    }
  };

  const handleFileUpload = useCallback(async (files: FileList) => {
    const formData = new FormData();

    for (const file of Array.from(files)) {
      formData.append('file', file);
      if (currentFolderId) {
        formData.append('folderId', currentFolderId);
      }

      try {
        const response = await fetch('/api/drive/upload', {
          method: 'POST',
          body: formData,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          },
        });

        if (!response.ok) throw new Error('Upload failed');

        toast.success(`Uploaded ${file.name}`);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  // Import handlers
  const handleStartImport = async (source: 'google_drive' | 'onedrive') => {
    setImportSource(source);
    setIsImportOpen(true);

    const redirectUri = `${window.location.origin}/drive`;

    try {
      if (source === 'google_drive') {
        const { url } = await getGoogleAuthUrlMutation.mutateAsync({ redirectUri });
        // Open OAuth popup
        const popup = window.open(url, 'Import from Google Drive', 'width=600,height=700');
        if (popup) {
          // Listen for OAuth callback
          const checkPopup = setInterval(() => {
            try {
              if (popup.closed) {
                clearInterval(checkPopup);
                return;
              }
              if (popup.location.href.includes(window.location.origin)) {
                const popupUrl = new URL(popup.location.href);
                const code = popupUrl.searchParams.get('code');
                popup.close();
                clearInterval(checkPopup);
                if (code) {
                  handleOAuthCallback(source, code, redirectUri);
                }
              }
            } catch {
              // Cross-origin - popup still on OAuth page
            }
          }, 500);
        }
      } else {
        const { url } = await getOneDriveAuthUrlMutation.mutateAsync({ redirectUri });
        const popup = window.open(url, 'Import from OneDrive', 'width=600,height=700');
        if (popup) {
          const checkPopup = setInterval(() => {
            try {
              if (popup.closed) {
                clearInterval(checkPopup);
                return;
              }
              if (popup.location.href.includes(window.location.origin)) {
                const popupUrl = new URL(popup.location.href);
                const code = popupUrl.searchParams.get('code');
                popup.close();
                clearInterval(checkPopup);
                if (code) {
                  handleOAuthCallback(source, code, redirectUri);
                }
              }
            } catch {
              // Cross-origin - popup still on OAuth page
            }
          }, 500);
        }
      }
    } catch {
      toast.error('Failed to start import');
      setIsImportOpen(false);
    }
  };

  const handleOAuthCallback = async (source: 'google_drive' | 'onedrive', code: string, redirectUri: string) => {
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
      await loadImportFiles(source, accessToken);
    } catch {
      toast.error('Failed to authenticate');
      setIsImportOpen(false);
    } finally {
      setImportLoading(false);
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
    try {
      if (importSource === 'google_drive') {
        const { jobId } = await importFromGoogleMutation.mutateAsync({
          accessToken: importAccessToken,
          fileIds: Array.from(selectedImportFiles),
          targetFolderId: currentFolderId,
        });
        toast.success(`Import started! Job ID: ${jobId.slice(0, 8)}...`);
      } else {
        const { jobId } = await importFromOneDriveMutation.mutateAsync({
          accessToken: importAccessToken,
          fileIds: Array.from(selectedImportFiles),
          targetFolderId: currentFolderId,
        });
        toast.success(`Import started! Job ID: ${jobId.slice(0, 8)}...`);
      }

      // Reset import state
      setIsImportOpen(false);
      setImportSource(null);
      setImportAccessToken(null);
      setImportFiles([]);
      setSelectedImportFiles(new Set());
      setImportFolderStack([]);

      // Refresh file list after a short delay
      setTimeout(() => invalidate(), 2000);
    } catch {
      toast.error('Failed to start import');
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Nubo Drive</h1>
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
                  From Google Drive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStartImport('onedrive')}>
                  <CloudDownload className="mr-2 h-4 w-4" />
                  From OneDrive
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

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
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
                onDoubleClick={() => file.isEditable ? handleOpenEditor(file.id) : handleDownload(file.id, file.name)}
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
                    onDoubleClick={() => file.isEditable ? handleOpenEditor(file.id) : handleDownload(file.id, file.name)}
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
                              {file.isEditable && (
                                <DropdownMenuItem onClick={() => handleOpenEditor(file.id)}>
                                  Open in Editor
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleDownload(file.id, file.name)}>
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleStar(file.id)}>
                                {file.isStarred ? 'Unstar' : 'Star'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setRenameTarget({ id: file.id, name: file.name, type: 'file' });
                                setIsRenameOpen(true);
                              }}>
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(file.id, 'file')}
                              >
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
                      <div className="flex items-center gap-3 px-4 py-2 bg-muted/50">
                        <button
                          onClick={handleSelectAllImport}
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
                        </button>
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
    </div>
  );
}
