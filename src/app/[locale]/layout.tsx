import type { Metadata } from "next";
import { Geist, Noto_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { isRtl } from "@/lib/i18n/config";
import Header from "@/components/public/Header";
import Footer from "@/components/public/Footer";
import LocalBusinessJsonLd from "@/components/public/LocalBusinessJsonLd";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Arabic is a heavy script by default; subsetting to "arabic" keeps the
// payload small. The font file size is reported by next/font at build time.
// Loaded ONLY for the ar locale below — fr/en visitors never download it.
const arabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "Metadata" });
  // Layout sets only locale-agnostic defaults. Canonicals, hreflang
  // alternates and OG urls are per-page via pageMetadata() — the layout
  // cannot know the child path, and stamping "/" here would canonicalize
  // every subpage (and every token URL) to the homepage.
  return {
    title: t("title"),
    description: t("description"),
  };
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const dir = isRtl(locale) ? "rtl" : "ltr";
  // Arabic ships only on Arabic pages (2/3 of traffic never downloads Noto
  // Sans Arabic), and the mono face lives in the admin layout where tables
  // actually use it — the public layout keeps a single Latin text face.
  const arabicClass = locale === "ar" ? arabic.variable : "";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${arabicClass} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocalBusinessJsonLd locale={locale} />
        <NextIntlClientProvider messages={messages}>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
