import { useTRPC } from '@/providers/query-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/kanban-board';
import { Button } from '@/components/ui/button';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function KanbanPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  // Get all connections to allow board creation per connection
  const { data: connectionsData } = useQuery(trpc.connections.list.queryOptions());
  const connections = connectionsData?.connections || [];

  // Get all boards
  const { data: boards, isLoading: boardsLoading } = useQuery(
    trpc.kanban.getBoards.queryOptions({})
  );

  const { mutate: createBoard, isPending: isCreating } = useMutation({
    ...trpc.kanban.createBoard.mutationOptions(),
    onSuccess: (newBoard) => {
      queryClient.invalidateQueries(trpc.kanban.getBoards.queryOptions({}));
      setSelectedBoardId(newBoard.id);
    },
    onError: (error: any) => {
      console.error('[KanbanPage] Error creating board:', error);
      // Invalidate connections query to refresh the list
      queryClient.invalidateQueries(trpc.connections.list.queryOptions());
    },
  });

  const { mutate: deleteBoard, isPending: isDeleting } = useMutation({
    ...trpc.kanban.deleteBoard.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.kanban.getBoards.queryOptions({}));
      setSelectedBoardId(null);
    },
    onError: (error: any) => {
      console.error('[KanbanPage] Error deleting board:', error);
    },
  });

  const handleCreateBoard = () => {
    // eslint-disable-next-line no-alert
    const boardName = prompt('Enter board name:');
    if (!boardName || !boardName.trim()) return;

    if (!connections || connections.length === 0) {
      console.error('[KanbanPage] No connections available');
      return;
    }

    // Use the first connection for now
    const connection = connections[0];
    if (!connection || !connection.id) {
      console.error('[KanbanPage] Invalid connection:', connection);
      return;
    }

    console.log('[KanbanPage] Creating board with connection:', {
      connectionId: connection.id,
      email: connection.email,
      boardName,
    });

    createBoard({
      connectionId: connection.id,
      name: boardName.trim(),
      isDefault: boards?.length === 0,
    });
  };

  const handleDeleteBoard = () => {
    if (!currentBoard) return;

    // eslint-disable-next-line no-alert
    if (confirm(`Are you sure you want to delete "${currentBoard.name}"? This action cannot be undone.`)) {
      deleteBoard({ boardId: currentBoard.id });
    }
  };

  // Auto-select the first board or default board
  const currentBoard = selectedBoardId
    ? boards?.find((b) => b.id === selectedBoardId)
    : boards?.find((b) => b.isDefault) || boards?.[0];

  if (boardsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!boards || boards.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Kanban Boards</h2>
          <p className="text-muted-foreground">
            Create your first board to start organizing emails
          </p>
        </div>
        <Button onClick={handleCreateBoard} disabled={isCreating}>
          {isCreating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Create Board
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b px-4 sm:px-6 py-3 flex-shrink-0">
        <Select
          value={currentBoard?.id || ''}
          onValueChange={setSelectedBoardId}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Select board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((board) => (
              <SelectItem key={board.id} value={board.id}>
                {board.name}
                {board.isDefault && ' (Default)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleDeleteBoard}
            disabled={isDeleting || !currentBoard}
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Delete Board</span>
              </>
            )}
          </Button>
          <Button onClick={handleCreateBoard} disabled={isCreating} variant="outline" size="sm" className="flex-1 sm:flex-none">
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">Creating...</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">New Board</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {currentBoard ? (
        <KanbanBoard key={currentBoard.id} boardId={currentBoard.id} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">Select a board to view</p>
        </div>
      )}
    </div>
  );
}
