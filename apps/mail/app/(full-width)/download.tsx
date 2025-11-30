import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, Download, Apple, Monitor, Smartphone, Globe } from 'lucide-react';
import { Navigation } from '@/components/navigation';
import { Button } from '@/components/ui/button';
import Footer from '@/components/home/footer';
import React from 'react';

type Platform = 'macos-arm' | 'macos-intel' | 'windows' | 'linux';

interface DownloadOption {
  id: Platform;
  name: string;
  description: string;
  icon: React.ReactNode;
  downloadUrl: string;
  fileSize: string;
  architecture?: string;
}

const GITHUB_RELEASES_URL = 'https://github.com/Chandorkar-Technologies/Zero/releases/latest';

const downloadOptions: DownloadOption[] = [
  {
    id: 'macos-arm',
    name: 'macOS (Apple Silicon)',
    description: 'For Mac with M1, M2, or M3 chip',
    icon: <Apple className="h-8 w-8" />,
    downloadUrl: `${GITHUB_RELEASES_URL}/download/v1.0.0/Nubo-1.0.0-arm64.dmg`,
    fileSize: '~94 MB',
    architecture: 'ARM64',
  },
  {
    id: 'macos-intel',
    name: 'macOS (Intel)',
    description: 'For Mac with Intel processor',
    icon: <Apple className="h-8 w-8" />,
    downloadUrl: `${GITHUB_RELEASES_URL}/download/v1.0.0/Nubo-1.0.0.dmg`,
    fileSize: '~98 MB',
    architecture: 'x64',
  },
  {
    id: 'windows',
    name: 'Windows',
    description: 'For Windows 10 or later (Coming Soon)',
    icon: <Monitor className="h-8 w-8" />,
    downloadUrl: `${GITHUB_RELEASES_URL}`,
    fileSize: 'Coming Soon',
    architecture: 'x64 / ARM64',
  },
  {
    id: 'linux',
    name: 'Linux (x64)',
    description: 'AppImage for most Linux distributions',
    icon: <Monitor className="h-8 w-8" />,
    downloadUrl: `${GITHUB_RELEASES_URL}/download/v1.0.0/Nubo-1.0.0.AppImage`,
    fileSize: '~103 MB',
    architecture: 'x64',
  },
];

function DownloadCard({ option }: { option: DownloadOption }) {
  return (
    <a
      href={option.downloadUrl}
      className="group block rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-blue-500 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-500"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-gray-100 p-3 text-gray-600 group-hover:bg-blue-100 group-hover:text-blue-600 dark:bg-gray-800 dark:text-gray-400 dark:group-hover:bg-blue-900/50 dark:group-hover:text-blue-400">
          {option.icon}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white">{option.name}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{option.description}</p>
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span>{option.fileSize}</span>
            {option.architecture && (
              <>
                <span>|</span>
                <span>{option.architecture}</span>
              </>
            )}
          </div>
        </div>
        <Download className="h-5 w-5 text-gray-400 transition-colors group-hover:text-blue-500" />
      </div>
    </a>
  );
}

export default function DownloadPage() {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-auto bg-white dark:bg-[#111111]">
      <Navigation />
      <div className="relative z-10 flex grow flex-col">
        <div className="absolute right-4 top-6 md:left-8 md:right-auto md:top-8">
          <a href="/">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-gray-600 hover:text-gray-900 dark:text-white dark:hover:text-white/80"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </a>
        </div>

        <div className="container mx-auto max-w-4xl px-4 py-16">
          <Card className="overflow-hidden rounded-xl border-none bg-gray-50/80 dark:bg-transparent">
            <CardHeader className="space-y-4 px-8 py-8">
              <div className="space-y-2 text-center">
                <CardTitle className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl dark:text-white">
                  Download Nubo
                </CardTitle>
                <CardDescription className="text-lg text-gray-600 dark:text-gray-400">
                  Get the desktop app for the best experience
                </CardDescription>
              </div>
            </CardHeader>

            <div className="space-y-6 p-8">
              {/* Desktop Apps */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Desktop Apps
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {downloadOptions.map((option) => (
                    <DownloadCard key={option.id} option={option} />
                  ))}
                </div>
              </div>

              {/* PWA / Web App */}
              <div className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Web App (PWA)
                </h2>
                <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-gray-100 p-3 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      <Globe className="h-8 w-8" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        Install as Web App
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Use Nubo directly in your browser. You can also install it as a Progressive
                        Web App (PWA) for an app-like experience.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <a href="/login">
                          <Button variant="outline" size="sm" className="gap-2">
                            <Globe className="h-4 w-4" />
                            Open Web App
                          </Button>
                        </a>
                      </div>
                      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                        Tip: In Chrome, click the install icon in the address bar to add Nubo to
                        your desktop.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile Apps Coming Soon */}
              <div className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Mobile Apps</h2>
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900/50">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-gray-200 p-3 text-gray-400 dark:bg-gray-800">
                      <Smartphone className="h-8 w-8" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-600 dark:text-gray-400">
                        Coming Soon
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
                        Native iOS and Android apps are in development. For now, use the web app on
                        your mobile browser.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Release Notes */}
              <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900/50">
                <h3 className="font-semibold text-gray-900 dark:text-white">Current Version</h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Version 1.0.0 - The desktop app loads Nubo from the web, so you'll always have the
                  latest features automatically.
                </p>
                <a
                  href="https://github.com/Mail-0/Zero/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  View all releases on GitHub
                  <ArrowLeft className="ml-1 h-3 w-3 rotate-180" />
                </a>
              </div>
            </div>
          </Card>
        </div>

        <Footer />
      </div>
    </div>
  );
}
