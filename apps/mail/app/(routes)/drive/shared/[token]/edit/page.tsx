import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: any) => {
        destroyEditor: () => void;
      };
    };
  }
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
  owner: {
    name: string;
  } | null;
}

export default function SharedEditorPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);

  const backendUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL || '';

  // Fetch share info first
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

        if (data.accessLevel !== 'edit') {
          setError('You do not have edit access to this file');
          setLoading(false);
          return;
        }

        setShareInfo(data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching share info:', err);
        setError('Failed to load shared item');
        setLoading(false);
      }
    };

    fetchShareInfo();
  }, [token, backendUrl]);

  // Initialize editor after share info is loaded
  useEffect(() => {
    if (!shareInfo || !token) return;

    let mounted = true;
    let scriptElement: HTMLScriptElement | null = null;

    const initEditor = async () => {
      try {
        // Get editor config for shared file
        const response = await fetch(`${backendUrl}/api/drive/shared/${token}/editor-config`);
        const data = await response.json();

        if (!response.ok) {
          if (mounted) {
            setError(data.error || 'Failed to get editor configuration');
          }
          return;
        }

        const { config, onlyOfficeUrl } = data;

        if (!mounted) return;

        // Load OnlyOffice Document Server API script
        const script = document.createElement('script');
        script.src = `${onlyOfficeUrl}/web-apps/apps/api/documents/api.js`;
        script.async = true;

        script.onload = () => {
          if (!mounted) return;

          if (!window.DocsAPI) {
            setError('Failed to load OnlyOffice editor API');
            return;
          }

          try {
            // Initialize the editor
            const editor = new window.DocsAPI.DocEditor('onlyoffice-editor', {
              ...config,
              width: '100%',
              height: '100%',
              events: {
                onAppReady: () => {
                  if (mounted) {
                    setEditorLoaded(true);
                  }
                },
                onDocumentStateChange: (event: { data: boolean }) => {
                  console.log('Document modified:', event.data);
                },
                onError: (event: { data: { errorCode: number; errorDescription: string } }) => {
                  console.error('OnlyOffice error:', event.data);
                  if (mounted) {
                    setError(`Editor error: ${event.data.errorDescription}`);
                  }
                },
              },
            });

            editorRef.current = editor;
          } catch (initError) {
            console.error('Failed to initialize editor:', initError);
            if (mounted) {
              setError('Failed to initialize editor');
            }
          }
        };

        script.onerror = () => {
          console.error('Failed to load OnlyOffice API script');
          if (mounted) {
            setError('Failed to load OnlyOffice editor. Please check the server configuration.');
          }
        };

        document.body.appendChild(script);
        scriptElement = script;
      } catch (err) {
        console.error('Failed to get editor config:', err);
        if (mounted) {
          setError('Failed to initialize editor');
        }
      }
    };

    initEditor();

    return () => {
      mounted = false;
      if (editorRef.current) {
        try {
          editorRef.current.destroyEditor();
        } catch (e) {
          console.error('Error destroying editor:', e);
        }
        editorRef.current = null;
      }
      if (scriptElement && scriptElement.parentNode) {
        scriptElement.parentNode.removeChild(scriptElement);
      }
    };
  }, [shareInfo, token, backendUrl]);

  if (loading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-muted-foreground">Loading editor...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
        <AlertCircle className="h-16 w-16 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={() => navigate(`/drive/shared/${token}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to File
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-4 border-b p-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/drive/shared/${token}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-medium">{shareInfo?.file?.name || 'Loading...'}</h1>
          {shareInfo?.owner && (
            <p className="text-sm text-muted-foreground">Shared by {shareInfo.owner.name}</p>
          )}
        </div>
        {!editorLoaded && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading editor...
          </div>
        )}
      </div>

      {/* Editor Container */}
      <div className="flex-1 relative">
        <div
          id="onlyoffice-editor"
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
