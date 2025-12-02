import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { CommandPaletteProvider } from '@/components/context/command-palette-context';
import { NuboIdBanner } from '@/components/nubo-id-banner';

import { Outlet } from 'react-router';


export default function Layout() {
  return (
    <CommandPaletteProvider>
      <HotkeyProviderWrapper>
        <div className="relative flex h-screen max-h-screen w-full flex-col overflow-hidden">
          <NuboIdBanner />
          <div className="relative flex flex-1 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </HotkeyProviderWrapper>
    </CommandPaletteProvider>
  );
}
