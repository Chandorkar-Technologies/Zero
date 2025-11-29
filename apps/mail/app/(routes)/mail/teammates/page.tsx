import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { TeammateCard } from '@/components/teammates/teammate-card';
import { TeammateDetail } from '@/components/teammates/teammate-detail';
import { Loader2, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Outputs } from '@zero/server/trpc';
import { useActiveConnection } from '@/hooks/use-connections';

type Teammate = Outputs['people']['getPeople'][0];

export default function TeammatesPage() {
  const trpc = useTRPC();
  const [selectedTeammate, setSelectedTeammate] = useState<Teammate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Get all connections first
  const { data: connectionsData } = useQuery(trpc.connections.list.queryOptions());
  const connections = connectionsData?.connections;

  // Get active connection to determine which one to use
  const { data: activeConnection, isLoading: isLoadingActive } = useActiveConnection();

  // Use active connection if available, otherwise fall back to first connection
  const connectionId = activeConnection?.id || connections?.[0]?.id;

  console.log('[TeammatesPage] Using connection:', {
    activeConnection,
    connections: connections?.length,
    connectionId,
    enabled: !!connectionId
  });

  // Get teammates
  const { data: teammates, isLoading, error } = useQuery({
    ...trpc.people.getPeople.queryOptions({
      connectionId: connectionId!,
      minThreads: 2,
    }),
    enabled: !!connectionId,
  });

  console.log('[TeammatesPage] Query result:', {
    teammates,
    isLoading,
    error,
    teammatesLength: teammates?.length
  });

  const filteredTeammates = teammates?.filter(
    (teammate) =>
      teammate.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      teammate.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      teammate.domain.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (selectedTeammate && connectionId) {
    return (
      <TeammateDetail
        teammate={selectedTeammate}
        connectionId={connectionId}
        onBack={() => setSelectedTeammate(null)}
      />
    );
  }

  if (isLoading || isLoadingActive || !connectionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <UsersIcon className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Email Connection</h2>
          <p className="text-muted-foreground">
            Connect an email account to see your contacts
          </p>
        </div>
      </div>
    );
  }

  if (!teammates || teammates.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <UsersIcon className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No People Found</h2>
          <p className="text-muted-foreground">
            We couldn't detect any frequent contacts yet. Keep emailing!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 sm:p-6">
        <h1 className="mb-2 sm:mb-4 text-xl sm:text-2xl font-semibold">People</h1>
        <p className="mb-3 sm:mb-4 text-sm sm:text-base text-muted-foreground">
          People you frequently communicate with from the same organization
        </p>

        <Input
          type="text"
          placeholder="Search people..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:max-w-md"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {filteredTeammates?.length} people found
          </p>
        </div>

        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTeammates?.map((teammate) => (
            <TeammateCard
              key={teammate.email}
              teammate={teammate}
              onClick={() => setSelectedTeammate(teammate)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
