import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { cookiePreferencesRouter } from './routes/cookies';
import { connectionsRouter } from './routes/connections';
import { categoriesRouter } from './routes/categories';
import { templatesRouter } from './routes/templates';
import { shortcutRouter } from './routes/shortcut';
import { settingsRouter } from './routes/settings';
import { getContext } from 'hono/context-storage';
import { draftsRouter } from './routes/drafts';
import { labelsRouter } from './routes/label';
import { notesRouter } from './routes/notes';
import { brainRouter } from './routes/brain';
import { userRouter } from './routes/user';
import { mailRouter } from './routes/mail';
import { bimiRouter } from './routes/bimi';
import { livekitRouter } from './routes/livekit';
import type { HonoContext } from '../ctx';
import { aiRouter } from './routes/ai';
import { router } from './trpc';
import { loggingRouter } from './routes/logging';
import { kanbanRouter } from './routes/kanban';
import { peopleRouter } from './routes/teammates'; // Renamed from teammates to people
import { notificationsRouter } from './routes/notifications';
import { attachmentsRouter } from './routes/attachments';
import { driveRouter } from './routes/drive';
import { pushRouter } from './routes/push';

export const appRouter = router({
  ai: aiRouter,
  attachments: attachmentsRouter,
  bimi: bimiRouter,
  brain: brainRouter,
  categories: categoriesRouter,
  connections: connectionsRouter,
  cookiePreferences: cookiePreferencesRouter,
  drafts: draftsRouter,
  drive: driveRouter,
  kanban: kanbanRouter,
  labels: labelsRouter,
  mail: mailRouter,
  notes: notesRouter,
  notifications: notificationsRouter,
  people: peopleRouter,
  push: pushRouter,
  shortcut: shortcutRouter,
  settings: settingsRouter,
  user: userRouter,
  templates: templatesRouter,
  logging: loggingRouter,
  livekit: livekitRouter,
});

export type AppRouter = typeof appRouter;

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;

export const serverTrpc = () => {
  const c = getContext<HonoContext>();
  return appRouter.createCaller({
    c,
    sessionUser: c.var.sessionUser,
    auth: c.var.auth,
  });
};
