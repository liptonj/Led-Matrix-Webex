import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <Header 
        title="Page Not Found" 
        tagline="The page you're looking for doesn't exist"
        showBrand={false}
      />
      
      <main className="container mx-auto px-4 py-16 text-center" id="main-content">
        <div className="max-w-md mx-auto">
          <div className="text-8xl mb-6">🔍</div>
          <h2 className="text-3xl font-bold mb-4">404 - Not Found</h2>
          <p className="text-[var(--color-text-muted)] mb-8">
            Sorry, the page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <div className="space-y-4">
            <Link href="/">
              <Button variant="primary" size="lg">
                ← Go to Home
              </Button>
            </Link>

            <div className="text-sm text-[var(--color-text-muted)] mt-8">
              <p>Here are some helpful links:</p>
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                <Link href="/install/" className="text-primary hover:underline">Install</Link>
                <Link href="/hardware/" className="text-primary hover:underline">Hardware</Link>
                <Link href="/troubleshooting/" className="text-primary hover:underline">Troubleshooting</Link>
                <Link href="/versions/" className="text-primary hover:underline">Downloads</Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
