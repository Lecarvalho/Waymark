import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const imageUrl = `${protocol}://${host}/og-milestone-2.png`;

  return {
    title: "Waymark · AI Navigability Auditor",
    description:
      "Measure how reliably and efficiently coding agents navigate a repository.",
    openGraph: {
      title: "Waymark · AI Navigability Auditor",
      description:
        "Measure how reliably and efficiently coding agents navigate a repository.",
      images: [{ url: imageUrl, width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Waymark · AI Navigability Auditor",
      description:
        "Measure how reliably and efficiently coding agents navigate a repository.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
