'use client';

import { useNavigation } from '@/hooks/useNavigation';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn, APP_VERSION } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';
import { Avatar } from './Avatar';

const navItems = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/install/', label: 'Install', icon: '🔌' },
  { href: '/hardware/', label: 'Hardware', icon: '📦' },
  { href: '/troubleshooting/', label: 'Troubleshoot', icon: '🔧' },
  { href: '/versions/', label: 'Downloads', icon: '⬇️' },
  { href: '/api-docs/', label: 'API Docs', icon: '📚' },
  { href: 'https://github.com/liptonj/Led-Matrix-Webex', label: 'GitHub', icon: '💻', external: true },
];

export function Navigation() {
  const { isOpen, toggle, close, navRef } = useNavigation();
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Hamburger Button - Mobile Only - Hidden when menu is open */}
      <button
        className={cn(
          'fixed top-4 left-4 z-[60] w-12 h-12 border-none rounded-xl cursor-pointer flex flex-col items-center justify-center gap-1.5 transition-all duration-200',
          'bg-[var(--color-surface)] shadow-elevated hover:shadow-lg hover:scale-105',
          isOpen && 'opacity-0 pointer-events-none',
          'lg:hidden'
        )}
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls="main-nav"
        aria-label="Toggle navigation menu"
      >
        <span className="block w-6 h-0.5 rounded-full transition-all duration-300 bg-[var(--color-text)]" />
        <span className="block w-6 h-0.5 rounded-full transition-all duration-300 bg-[var(--color-text)]" />
        <span className="block w-6 h-0.5 rounded-full transition-all duration-300 bg-[var(--color-text)]" />
      </button>

      {/* Backdrop - Mobile Only */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-[55] transition-all duration-200',
          isOpen ? 'opacity-100 visible' : 'opacity-0 invisible',
          'lg:hidden'
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Navigation Panel */}
      <nav
        ref={navRef}
        id="main-nav"
        className={cn(
          // Mobile styles
          'fixed top-0 left-0 w-72 h-full z-[58] flex flex-col shadow-2xl transition-transform duration-300',
          'bg-[var(--color-surface)]',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop styles
          'lg:static lg:w-auto lg:h-auto lg:translate-x-0 lg:bg-transparent lg:shadow-none lg:flex-row lg:items-center lg:gap-2'
        )}
        aria-label="Main navigation"
        aria-hidden={!isOpen}
      >
        {/* Nav Header - Mobile only */}
        <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] lg:hidden relative">
          <div className="flex items-center gap-3">
            <Image
              src="/icon-512.png"
              alt=""
              width={40}
              height={40}
              className="rounded-lg shadow-sm"
            />
            <div>
              <span className="font-bold text-base block">LED Matrix</span>
              <span className="text-xs text-[var(--color-text-muted)]">Webex Display</span>
            </div>
          </div>
          
          {/* Close button */}
          <button
            onClick={close}
            className="absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--color-bg-hover)]"
            aria-label="Close menu"
          >
            <span className="text-2xl leading-none">×</span>
          </button>
        </div>

        {/* Nav Links */}
        <div className="flex-1 py-2 overflow-y-auto lg:flex lg:flex-row lg:p-0 lg:overflow-visible lg:gap-2">
          {navItems.map((item) => {
            const active = isActive(item.href!);
            const isExternal = 'external' in item && item.external;

            return (
              <Link
                key={item.href}
                href={item.href!}
                onClick={close}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                className={cn(
                  // Mobile styles
                  'flex items-center gap-3 px-6 py-3.5 no-underline text-sm font-medium transition-all duration-200',
                  'hover:bg-[var(--color-bg-hover)] hover:text-primary',
                  active && 'bg-[var(--color-bg-hover)] text-primary border-l-4 border-primary',
                  // Desktop styles
                  'lg:border-l-0 lg:px-4 lg:py-2 lg:rounded-lg lg:text-sm',
                  active && 'lg:bg-[var(--color-bg-hover)]',
                  !active && 'lg:hover:bg-[var(--color-bg-hover)]'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span className="text-lg lg:text-base">{item.icon}</span>
                <span>{item.label}</span>
                {isExternal && <span className="ml-auto lg:ml-1 opacity-60 text-xs">↗</span>}
              </Link>
            );
          })}
        </div>

        {/* Theme Toggle and Avatar - Mobile Only */}
        <div className="p-4 px-6 border-t border-[var(--color-border)] lg:hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Account</span>
            <Avatar />
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            <p className="mb-1">Version {APP_VERSION}</p>
            <p className="opacity-75">MIT License</p>
          </div>
        </div>
      </nav>
    </>
  );
}
