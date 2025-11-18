import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTRPC } from '@/providers/query-provider';
import { GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { Outputs } from '@zero/server/trpc';

type BoardWithColumns = Outputs['kanban']['getBoardWithColumns'];
type EmailMapping = BoardWithColumns['columns'][0]['emails'][0];

interface EmailCardProps {
  email: EmailMapping;
}

export function EmailCard({ email }: EmailCardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${email.threadId}-${email.connectionId}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const { mutate: removeEmail } = useMutation({
    ...trpc.kanban.removeEmail.mutationOptions(),
    onSuccess: () => {
      // Invalidate the board query to refresh
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'kanban.getBoardWithColumns',
      });
    },
  });

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeEmail({
      threadId: email.threadId,
      connectionId: email.connectionId,
    });
  };

  const handleClick = () => {
    // Navigate to the email thread
    navigate(`/mail/inbox?threadId=${email.threadId}`);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-sm">
              {(email as any).subject || 'No Subject'}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleRemove}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {(email as any).senderName || (email as any).senderEmail || 'Unknown Sender'}
          </p>
          {(email as any).snippet && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {(email as any).snippet}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
