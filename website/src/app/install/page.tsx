import type { Metadata } from 'next';
import { Header, Footer } from '@/components/layout';
import { InstallWizard } from '@/components/install/InstallWizard';

export const metadata: Metadata = {
  title: 'Install Firmware',
  description: 'Install LED Matrix Webex Display firmware directly from your browser - no software required',
};

export default function InstallPage() {
  return (
    <>
      <Header 
        title="LED Matrix Webex Display" 
        tagline="Install firmware directly from your browser"
        showBrand={true}
      />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
        <InstallWizard />
      </main>

      <Footer />
    </>
  );
}
