import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { EmailCard } from './email-card';
import type { Outputs } from '@zero/server/trpc';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/providers/query-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';

type BoardWithColumns = Outputs['kanban']['getBoardWithColumns'];
type Column = BoardWithColumns['columns'][0];
type EmailMapping = Column['emails'][0];

interface KanbanColumnProps {
  column: Column;
  emails: EmailMapping[];
  boardId: string;
}

export function KanbanColumn({ column, emails, boardId }: KanbanColumnProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  const { mutate: deleteColumn } = useMutation({
    ...trpc.kanban.deleteColumn.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.kanban.getBoardWithColumns.queryOptions({ boardId })
      );
    },
  });

  const handleDelete = () => {
    if (emails.length > 0) {
      // eslint-disable-next-line no-alert
      const confirmed = confirm(
        `This column has ${emails.length} email(s). Are you sure you want to delete it? The emails will be removed from the kanban board.`
      );
      if (!confirmed) return;
    }
    deleteColumn({ columnId: column.id });
  };

  const emailIds = emails.map((email) => `${email.threadId}-${email.connectionId}`);

  return (
    <div className="flex w-80 flex-shrink-0 flex-col rounded-lg border bg-muted/50">
      <div
        className="group flex items-center gap-2 border-b px-4 py-3"
        style={{ borderTopColor: column.color || undefined }}
      >
        {column.color && (
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: column.color }}
          />
        )}
        <h3 className="font-medium">{column.name}</h3>
        <span className="ml-auto text-sm text-muted-foreground">
          {emails.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className="flex-1 space-y-2 overflow-y-auto p-4"
      >
        <SortableContext items={emailIds} strategy={verticalListSortingStrategy}>
          {emails
            .sort((a, b) => a.position - b.position)
            .map((email) => (
              <EmailCard
                key={`${email.threadId}-${email.connectionId}`}
                email={email}
              />
            ))}
        </SortableContext>

        {emails.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Drop emails here
          </div>
        )}
      </div>
    </div>
  );
}
