import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import Navigation from "@/components/Navigation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "The Live Podcast",
    template: "%s · The Live Podcast",
  },
  description:
    "Pause any YouTube podcast at the interesting moment and ask about it. The AI has watched it with you.",
  openGraph: {
    type: "website",
    siteName: "The Live Podcast",
    title: "The Live Podcast",
    description:
      "Pause any YouTube podcast at the interesting moment and ask about it.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "The Live Podcast",
    description:
      "Pause any YouTube podcast at the interesting moment and ask about it.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} overflow-x-hidden antialiased`}
      >
        <ClerkProvider
          signInUrl="/auth/signin"
          signUpUrl="/auth/signup"
          signInFallbackRedirectUrl="/library"
          signUpFallbackRedirectUrl="/library"
        >
          <Toaster position="top-right" richColors />
          <Navigation />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
