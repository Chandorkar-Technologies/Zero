import {
  Archive,
  Bin,
  ExclamationCircle,
  Folder,
  Inbox,
  SettingsGear,
  Stars,
  Tabs,
  Users,
  ArrowLeft,
  Danger,
  Sheet,
  Plane2,
  LockIcon,
  Clock,
} from '@/components/icons/icons';
import { MessageSquareIcon, Video, HardDrive, KanbanSquare, UserCircle, Bell, Paperclip, Headset } from 'lucide-react';
import { m } from '@/paraglide/messages';

export interface NavItem {
  id?: string;
  title: string;
  url: string;
  icon: React.ComponentType<any>;
  badge?: number;
  isBackButton?: boolean;
  isSettingsButton?: boolean;
  isSupportButton?: boolean;
  disabled?: boolean;
  target?: string;
  shortcut?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface NavConfig {
  path: string;
  sections: NavSection[];
}

// ! items title has to be a message key (check messages/en.json)
export const navigationConfig: Record<string, NavConfig> = {
  mail: {
    path: '/mail',
    sections: [
      {
        title: 'Core',
        items: [
          {
            id: 'inbox',
            title: m['navigation.sidebar.inbox'](),
            url: '/mail/inbox',
            icon: Inbox,
            shortcut: 'g + i',
          },
          {
            id: 'drafts',
            title: m['navigation.sidebar.drafts'](),
            url: '/mail/draft',
            icon: Folder,
            shortcut: 'g + d',
          },
          {
            id: 'sent',
            title: m['navigation.sidebar.sent'](),
            url: '/mail/sent',
            icon: Plane2,
            shortcut: 'g + t',
          },
          {
            id: 'meet',
            title: 'Nubo Meet',
            url: '/meet',
            icon: Video,
            shortcut: 'g + v',
          },
          {
            id: 'drive',
            title: 'Nubo Drive',
            url: '/drive',
            icon: HardDrive,
            shortcut: 'g + r',
          },
        ],
      },
      {
        title: 'Views',
        items: [
          {
            id: 'kanban',
            title: m['navigation.sidebar.kanban'](),
            url: '/mail/kanban',
            icon: KanbanSquare,
            shortcut: 'g + k',
          },
          {
            id: 'people',
            title: m['navigation.sidebar.people'](),
            url: '/mail/teammates',
            icon: UserCircle,
            shortcut: 'g + p',
          },
          {
            id: 'notifications',
            title: m['navigation.sidebar.notifications'](),
            url: '/mail/notifications',
            icon: Bell,
            shortcut: 'g + n',
          },
          {
            id: 'attachments',
            title: m['navigation.sidebar.attachments'](),
            url: '/mail/attachments',
            icon: Paperclip,
            shortcut: 'g + f',
          },
        ],
      },
      {
        title: 'Management',
        items: [
          {
            id: 'archive',
            title: m['navigation.sidebar.archive'](),
            url: '/mail/archive',
            icon: Archive,
            shortcut: 'g + a',
          },
          {
            id: 'snoozed',
            title: m['navigation.sidebar.snoozed'](),
            url: '/mail/snoozed',
            icon: Clock,
            shortcut: 'g + z',
          },
          {
            id: 'spam',
            title: m['navigation.sidebar.spam'](),
            url: '/mail/spam',
            icon: ExclamationCircle,
          },
          {
            id: 'trash',
            title: m['navigation.sidebar.bin'](),
            url: '/mail/bin',
            icon: Bin,
          },
        ],
      },
      // {
      //   title: "Categories",
      //   items: [
      //     {
      //       title: "Social",
      //       url: "/mail/inbox?category=social",
      //       icon: UsersIcon,
      //       badge: 972,
      //     },
      //     {
      //       title: "Updates",
      //       url: "/mail/inbox?category=updates",
      //       icon: BellIcon,
      //       badge: 342,
      //     },
      //     {
      //       title: "Forums",
      //       url: "/mail/inbox?category=forums",
      //       icon: MessageCircleIcon,
      //       badge: 128,
      //     },
      //     {
      //       title: "Shopping",
      //       url: "/mail/inbox?category=shopping",
      //       icon: CartIcon,
      //       badge: 8,
      //     },
      //   ],
      // },
    ],
  },
  meet: {
    path: '/meet',
    sections: [
      {
        title: 'Navigation',
        items: [
          {
            title: m['common.actions.back'](),
            url: '/mail',
            icon: ArrowLeft,
            isBackButton: true,
          },
        ],
      },
    ],
  },
  settings: {
    path: '/settings',
    sections: [
      {
        title: 'Settings',
        items: [
          {
            title: m['common.actions.back'](),
            url: '/mail',
            icon: ArrowLeft,
            isBackButton: true,
          },

          {
            title: m['navigation.settings.general'](),
            url: '/settings/general',
            icon: SettingsGear,
            shortcut: 'g + s',
          },
          {
            title: m['navigation.settings.connections'](),
            url: '/settings/connections',
            icon: Users,
          },
          {
            title: m['navigation.settings.privacy'](),
            url: '/settings/privacy',
            icon: LockIcon,
          },
          {
            title: m['navigation.settings.appearance'](),
            url: '/settings/appearance',
            icon: Stars,
          },
          {
            title: m['navigation.settings.labels'](),
            url: '/settings/labels',
            icon: Sheet,
          },
          {
            title: m['navigation.settings.categories'](),
            url: '/settings/categories',
            icon: Tabs,
          },
          {
            title: m['navigation.settings.signatures'](),
            url: '/settings/signatures',
            icon: MessageSquareIcon,
            disabled: true,
          },
          {
            title: m['navigation.settings.shortcuts'](),
            url: '/settings/shortcuts',
            icon: Tabs,
            shortcut: '?',
          },
          // {
          //   title: 'navigation.settings.signatures',
          //   url: '/settings/signatures',
          //   icon: MessageSquareIcon,
          //   disabled: true,
          // },
          // {
          //   title: 'navigation.settings.shortcuts',
          //   url: '/settings/shortcuts',
          //   icon: Tabs,
          //   disabled: true,
          // },
          // {
          //   title: "Notifications",
          //   url: "/settings/notifications",
          //   icon: BellIcon,
          // },
          {
            title: m['navigation.settings.deleteAccount'](),
            url: '/settings/danger-zone',
            icon: Danger,
          },
        ].map((item) => ({
          ...item,
          isSettingsPage: true,
        })),
      },
    ],
  },
};

export const bottomNavItems = [
  {
    title: '',
    items: [
      {
        id: 'support',
        title: m['navigation.sidebar.support'](),
        url: '#support',
        icon: Headset,
        isSupportButton: true,
      },
      {
        id: 'settings',
        title: m['navigation.sidebar.settings'](),
        url: '/settings/general',
        icon: SettingsGear,
        isSettingsButton: true,
      },
    ],
  },
];
