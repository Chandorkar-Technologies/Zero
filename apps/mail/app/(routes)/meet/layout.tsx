import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { AppSidebar } from '@/components/ui/app-sidebar';
import { Outlet } from 'react-router';

export default function MeetLayout() {
  return (
    <HotkeyProviderWrapper>
      <AppSidebar />
      <div className="flex-1 bg-sidebar dark:bg-sidebar">
        <Outlet />
      </div>
    </HotkeyProviderWrapper>
  );
}
