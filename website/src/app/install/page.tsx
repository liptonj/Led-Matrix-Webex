import type { Metadata } from 'next';
import Script from 'next/script';
import { Header, Footer, Breadcrumbs } from '@/components/layout';
import { InstallWizard } from '@/components/install/InstallWizard';

export const metadata: Metadata = {
  title: 'Install Firmware',
  description: 'Install LED Matrix Webex Display firmware directly from your browser - no software required',
};

export default function InstallPage() {
  return (
    <>
      <Script
        src="https://unpkg.com/esp-web-tools@10.2.1/dist/web/install-button.js"
        type="module"
        strategy="afterInteractive"
      />
      <Header 
        title="LED Matrix Webex Display" 
        tagline="Install firmware directly from your browser"
        showBrand={true}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        <Breadcrumbs />
        <InstallWizard />
      </main>

      <Footer />
    </>
  );
}
