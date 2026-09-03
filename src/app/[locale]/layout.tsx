import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { isRtl } from "@/lib/i18n/config";
import { getAlternateUrls, getCanonicalUrl } from "@/lib/seo/canonical";
import Header from "@/components/public/Header";
import Footer from "@/components/public/Footer";
import LocalBusinessJsonLd from "@/components/public/LocalBusinessJsonLd";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arabic is a heavy script by default; subsetting to "arabic" keeps the
// payload small. The font file size is reported by next/font at build time.
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
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const alternates = getAlternateUrls("/");
  // getAlternateUrls("/") returns absolute URLs already; rebuild per-locale
  // paths relative to the homepage so hreflang stays correct.
  void alternates;
  const languages: Record<string, string> = {
    fr: getCanonicalUrl("fr", "/"),
    ar: getCanonicalUrl("ar", "/"),
    en: getCanonicalUrl("en", "/"),
    "x-default": getCanonicalUrl("fr", "/"),
  };
  return {
    title: t("title"),
    description: t("description"),
    metadataBase: new URL(base),
    alternates: {
      canonical: getCanonicalUrl(locale, "/"),
      languages,
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: getCanonicalUrl(locale, "/"),
      siteName: "Ortho'Care Clinic",
      locale: locale === "ar" ? "ar_DZ" : locale === "en" ? "en_US" : "fr_DZ",
      alternateLocale: ["fr_DZ", "ar_DZ", "en_US"].filter(
        (l) => l !== (locale === "ar" ? "ar_DZ" : locale === "en" ? "en_US" : "fr_DZ")
      ),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
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

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${arabic.variable} h-full antialiased`}
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
