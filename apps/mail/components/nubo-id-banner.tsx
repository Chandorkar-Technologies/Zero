'use client';

import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { AtSign, X } from 'lucide-react';
import { useState, useEffect } from 'react';

const BANNER_DISMISSED_KEY = 'nubo-id-banner-dismissed';

export function NuboIdBanner() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const [isDismissed, setIsDismissed] = useState(true); // Start dismissed to avoid flash

  // Check localStorage on mount
  useEffect(() => {
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY);
    setIsDismissed(dismissed === 'true');
  }, []);

  const { data: myUsername, isLoading } = useQuery(
    trpc.drive.getMyUsername.queryOptions(void 0, {
      retry: false,
    }),
  );

  const handleDismiss = () => {
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
    setIsDismissed(true);
  };

  // Don't show if:
  // - Still loading
  // - User already has a username
  // - Banner was dismissed
  // - Query failed (myUsername is undefined)
  if (isLoading || !myUsername || myUsername.username || isDismissed) {
    return null;
  }

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
          <AtSign className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">
            Set up your Nubo ID to let others share files with you easily
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-800/50"
            onClick={() => navigate('/settings/general')}
          >
            Set up now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-yellow-800 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-800/50 h-8 w-8 p-0"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
