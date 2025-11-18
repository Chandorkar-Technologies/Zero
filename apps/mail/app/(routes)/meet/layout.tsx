import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { AppSidebar } from '@/components/ui/app-sidebar';
import { Outlet } from 'react-router';

export default function MeetLayout() {
  return (
    <HotkeyProviderWrapper>
      <AppSidebar />
      <div className="w-full">
        <Outlet />
      </div>
    </HotkeyProviderWrapper>
  );
}
