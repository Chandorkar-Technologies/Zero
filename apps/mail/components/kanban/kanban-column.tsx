import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { EmailCard } from './email-card';
import type { Outputs } from '@zero/server/trpc';

type BoardWithColumns = Outputs['kanban']['getBoardWithColumns'];
type Column = BoardWithColumns['columns'][0];
type EmailMapping = Column['emails'][0];

interface KanbanColumnProps {
  column: Column;
  emails: EmailMapping[];
}

export function KanbanColumn({ column, emails }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  const emailIds = emails.map((email) => `${email.threadId}-${email.connectionId}`);

  return (
    <div className="flex w-80 flex-shrink-0 flex-col rounded-lg border bg-muted/50">
      <div
        className="flex items-center gap-2 border-b px-4 py-3"
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
