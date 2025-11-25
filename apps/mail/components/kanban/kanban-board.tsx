import { useTRPC } from '@/providers/query-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

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
    console.log('[Kanban] Drag start:', active.id);
    const email = board?.columns
      .flatMap((col) => col.emails)
      .find((e) => `${e.threadId}-${e.connectionId}` === active.id);
    if (email) {
      console.log('[Kanban] Found email:', email.subject);
      setActiveEmail(email);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    console.log('[Kanban] Drag end:', { active: active.id, over: over?.id });
    setActiveEmail(null);

    if (!over) {
      console.log('[Kanban] No drop target');
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) {
      console.log('[Kanban] Dropped on self');
      return;
    }

    // Parse thread and connection IDs from active
    // Format is: threadId-connectionId (where connectionId is a UUID with dashes)
    // So we need to split only on the FIRST dash
    const firstDashIndex = activeId.indexOf('-');
    const threadId = activeId.substring(0, firstDashIndex);
    const connectionId = activeId.substring(firstDashIndex + 1);

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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold truncate">{board.name}</h1>
          <Button onClick={handleAddColumn} variant="outline" size="sm" className="flex-shrink-0">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Column</span>
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 min-h-0">
          <div className="flex gap-4 h-full">
            {board.columns
              .sort((a, b) => a.position - b.position)
              .map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  emails={column.emails}
                  boardId={boardId}
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
