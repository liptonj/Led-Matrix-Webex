import Image from 'next/image';
import { ThemeToggle } from './ThemeToggle';
import { Navigation } from './Navigation';

interface HeaderProps {
  title?: string;
  tagline?: string;
  showBrand?: boolean;
}

export function Header({ 
  title = 'LED Matrix Webex Display', 
  tagline = 'Show your Webex presence status on a physical LED matrix display',
  showBrand = true 
}: HeaderProps) {
  return (
    <>
      <Navigation />
      <header 
        className="text-center py-8 shadow-elevated relative"
        style={{ background: 'var(--header-gradient)', color: 'var(--footer-text)' }}
      >
        <div className="container mx-auto px-4 flex flex-col items-center gap-2">
          {showBrand && (
            <div className="flex items-center justify-center gap-3">
              <Image
                src="/icon-512.png"
                alt="LED Matrix Webex Display Logo"
                width={48}
                height={48}
                className="rounded-lg"
                priority
              />
              <h1 className="text-2xl md:text-3xl font-semibold mb-0 text-white">
                {title}
              </h1>
            </div>
          )}
          {!showBrand && (
            <h1 className="text-2xl md:text-3xl font-semibold mb-0 text-white">
              {title}
            </h1>
          )}
          <p className="text-base opacity-90 mb-0">{tagline}</p>
          <div className="mt-4 flex gap-3 items-center">
            <ThemeToggle />
          </div>
        </div>
      </header>
    </>
  );
}
