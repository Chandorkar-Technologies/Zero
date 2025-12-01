import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://join.nubo.email'),
  title: 'Nubo - Join the Waitlist | Made in Bharat',
  description: 'Be among the first 10,000 to experience Nubo - AI-powered email, storage, and collaboration. Save 80% vs Google Workspace. Proudly Made in India.',
  keywords: 'Nubo, email, storage, AI, Made in India, Bharat, Google Workspace alternative, Microsoft 365 alternative',
  openGraph: {
    title: 'Nubo - Join the Revolution | Made in Bharat',
    description: 'Be among the first 10,000 to experience Nubo - AI-powered email, storage, and collaboration.',
    images: ['/og-image.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nubo - Join the Revolution',
    description: 'AI-powered email & storage. Made in Bharat.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
