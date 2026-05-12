import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GTLNAV — Navigate The Future Infrastructure",
  description:
    "GTLNAV is the cloud infrastructure platform inside the GODTECHLABS ecosystem. Hosting, deployment, domains, SSL, VPS and cloud storage — engineered for the next generation of builders.",
  metadataBase: new URL("https://gtlnav.godtechlabs.com"),
  applicationName: "GTLNAV",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      {
        url: "/branding/favicon-16x16.png",
        type: "image/png",
        sizes: "16x16",
      },
      {
        url: "/branding/favicon-32x32.png",
        type: "image/png",
        sizes: "32x32",
      },
    ],
    shortcut: "/favicon.ico",
    apple: {
      url: "/branding/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
  openGraph: {
    title: "GTLNAV — Navigate The Future Infrastructure",
    description:
      "Cloud hosting, deployment, domains and infrastructure inside the GODTECHLABS ecosystem.",
    type: "website",
    images: [
      {
        url: "/branding/gtlnav-logo.png",
        width: 512,
        height: 512,
        alt: "GTLNAV",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-black text-white selection:bg-basil-400/40">
        {children}
      </body>
    </html>
  );
}
