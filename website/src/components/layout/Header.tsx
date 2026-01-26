import Image from 'next/image';
import Link from 'next/link';
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
      {/* Top Navigation Bar with Logo and Theme Toggle */}
      <div className="sticky top-0 z-50 bg-[var(--color-surface)] border-b border-[var(--color-border)] shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 no-underline group ml-14 lg:ml-0">
            <Image
              src="/icon-512.png"
              alt="LED Matrix Webex Display"
              width={40}
              height={40}
              className="rounded-lg transition-transform group-hover:scale-105"
              priority
            />
            <div className="hidden sm:block">
              <div className="font-bold text-base leading-tight">
                LED Matrix
              </div>
              <div className="text-xs text-[var(--color-text-muted)] leading-tight">
                Webex Display
              </div>
            </div>
          </Link>

          {/* Navigation - includes hamburger on mobile, desktop nav on large screens */}
          <Navigation />

          {/* Theme Toggle - Desktop only */}
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Hero Section */}
      {showBrand && (
        <header className="py-12 shadow-lg text-white" style={{ background: 'var(--header-gradient)' }}>
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              {title}
            </h1>
            <p className="text-lg opacity-90 max-w-2xl mx-auto">
              {tagline}
            </p>
          </div>
        </header>
      )}
    </>
  );
}
