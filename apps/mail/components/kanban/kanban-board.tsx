import { useTRPC } from '@/providers/query-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { KanbanColumn } from './kanban-column';
import { EmailCard } from './email-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import type { Outputs } from '@zero/server/trpc';

type BoardWithColumns = Outputs['kanban']['getBoardWithColumns'];
type EmailMapping = BoardWithColumns['columns'][0]['emails'][0];

interface KanbanBoardProps {
  boardId: string;
}

export function KanbanBoard({ boardId }: KanbanBoardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [activeEmail, setActiveEmail] = useState<EmailMapping | null>(null);

  const { data: board, isLoading } = useQuery(
    trpc.kanban.getBoardWithColumns.queryOptions({ boardId })
  );

  const { mutate: moveEmail } = useMutation({
    ...trpc.kanban.moveEmail.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.kanban.getBoardWithColumns.queryOptions({ boardId })
      );
    },
  });

  const { mutate: createColumn } = useMutation({
    ...trpc.kanban.createColumn.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.kanban.getBoardWithColumns.queryOptions({ boardId })
      );
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const email = board?.columns
      .flatMap((col) => col.emails)
      .find((e) => `${e.threadId}-${e.connectionId}` === active.id);
    if (email) {
      setActiveEmail(email);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveEmail(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    // Parse thread and connection IDs from active
    const [threadId, connectionId] = activeId.split('-');

    // Find which column the active email is currently in
    const activeColumn = board?.columns.find((col) =>
      col.emails.some((e) => `${e.threadId}-${e.connectionId}` === activeId)
    );

    // Check if dropped over a column
    const targetColumn = board?.columns.find((col) => col.id === overId);

    if (targetColumn) {
      // Dropped on a column - append to end
      const position = targetColumn.emails.length;

      moveEmail({
        threadId,
        connectionId,
        columnId: targetColumn.id,
        position,
      });
      return;
    }

    // Check if dropped over another email
    const targetEmail = board?.columns
      .flatMap((col) => col.emails)
      .find((e) => `${e.threadId}-${e.connectionId}` === overId);

    if (targetEmail) {
      // Find the column containing the target email
      const targetColumn = board?.columns.find((col) =>
        col.emails.some((e) => `${e.threadId}-${e.connectionId}` === overId)
      );

      if (targetColumn) {
        // Get the position of the target email
        const targetPosition = targetColumn.emails.findIndex(
          (e) => `${e.threadId}-${e.connectionId}` === overId
        );

        // If moving within the same column, adjust position
        let newPosition = targetPosition;
        if (activeColumn?.id === targetColumn.id) {
          const activePosition = activeColumn.emails.findIndex(
            (e) => `${e.threadId}-${e.connectionId}` === activeId
          );
          if (activePosition < targetPosition) {
            newPosition = targetPosition - 1;
          }
        }

        moveEmail({
          threadId,
          connectionId,
          columnId: targetColumn.id,
          position: newPosition,
        });
      }
    }
  };

  const handleAddColumn = () => {
    // eslint-disable-next-line no-alert
    const columnName = prompt('Enter column name:');
    if (!columnName || !board) return;

    const position = board.columns.length;
    createColumn({
      boardId: board.id,
      name: columnName,
      color: '#6366f1',
      position,
    });
  };

  if (isLoading || !board) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading board...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{board.name}</h1>
          <Button onClick={handleAddColumn} variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Column
          </Button>
        </div>
      </div>

      <DndContext
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-4 p-6 min-w-max">
            {board.columns
              .sort((a, b) => a.position - b.position)
              .map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  emails={column.emails}
                />
              ))}
          </div>
        </div>

        <DragOverlay>
          {activeEmail ? (
            <div className="rotate-3 opacity-90">
              <EmailCard email={activeEmail} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
