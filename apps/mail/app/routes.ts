import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
  index('page.tsx'),
  route('/home', 'home/page.tsx'),

  route('/api/mailto-handler', 'mailto-handler.ts'),

  layout('(full-width)/layout.tsx', [
    route('/about', '(full-width)/about.tsx'),
    route('/terms', '(full-width)/terms.tsx'),
    route('/pricing', '(full-width)/pricing.tsx'),
    route('/privacy', '(full-width)/privacy.tsx'),
    route('/contributors', '(full-width)/contributors.tsx'),
    route('/download', '(full-width)/download.tsx'),
    route('/hr', '(full-width)/hr.tsx'),
    route('/meet/:meetingId', '(full-width)/meet/[meetingId]/page.tsx'),
    route('/drive/shared/:token', '(routes)/drive/shared/[token]/page.tsx'),
    route('/drive/shared/:token/edit', '(routes)/drive/shared/[token]/edit/page.tsx'),
  ]),

  route('/login', '(auth)/login/page.tsx'),
  route('/signup', '(auth)/signup/page.tsx'),
  route('/forgot-password', '(auth)/forgot-password/page.tsx'),
  route('/reset-password', '(auth)/reset-password/page.tsx'),

  layout('(routes)/layout.tsx', [
    route('/developer', '(routes)/developer/page.tsx'),
    route('/meet', '(routes)/meet/page.tsx'),
    route('/drive', '(routes)/drive/page.tsx'),
    route('/chat', '(routes)/chat/page.tsx'),
    route('/drive/edit/:fileId', '(routes)/drive/edit/[fileId]/page.tsx'),
    layout(
      '(routes)/mail/layout.tsx',
      prefix('/mail', [
        index('(routes)/mail/page.tsx'),
        route('/create', '(routes)/mail/create/page.tsx'),
        route('/compose', '(routes)/mail/compose/page.tsx'),
        route('/kanban', '(routes)/mail/kanban/page.tsx'),
        route('/teammates', '(routes)/mail/teammates/page.tsx'),
        route('/notifications', '(routes)/mail/notifications/page.tsx'),
        route('/attachments', '(routes)/mail/attachments/page.tsx'),
        route('/under-construction/:path', '(routes)/mail/under-construction/[path]/page.tsx'),
        route('/:folder', '(routes)/mail/[folder]/page.tsx'),
      ]),
    ),
    layout(
      '(routes)/settings/layout.tsx',
      prefix('/settings', [
        index('(routes)/settings/page.tsx'),
        route('/appearance', '(routes)/settings/appearance/page.tsx'),
        route('/connections', '(routes)/settings/connections/page.tsx'),
        route('/danger-zone', '(routes)/settings/danger-zone/page.tsx'),
        route('/general', '(routes)/settings/general/page.tsx'),
        route('/labels', '(routes)/settings/labels/page.tsx'),
        route('/categories', '(routes)/settings/categories/page.tsx'),
        route('/notifications', '(routes)/settings/notifications/page.tsx'),
        route('/privacy', '(routes)/settings/privacy/page.tsx'),
        route('/security', '(routes)/settings/security/page.tsx'),
        route('/shortcuts', '(routes)/settings/shortcuts/page.tsx'),
        route('/*', '(routes)/settings/[...settings]/page.tsx'),
      ]),
    ),
    route('/*', 'meta-files/not-found.ts'),
  ]),
] satisfies RouteConfig;
