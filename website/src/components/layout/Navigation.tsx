'use client';

import { useNavigation } from '@/hooks/useNavigation';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/install/', label: 'Install', icon: '🔌' },
  { href: '/hardware/', label: 'Hardware', icon: '📦' },
  { href: '/troubleshooting/', label: 'Troubleshoot', icon: '🔧' },
  { divider: true },
  { href: '/versions/', label: 'Downloads', icon: '⬇️' },
  { href: '/api-docs/', label: 'API Docs', icon: '📚' },
  { href: '/embedded/', label: 'Embedded App', icon: '📱' },
  { divider: true },
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
      {/* Hamburger Button */}
      <button
        className={cn(
          'fixed top-4 left-4 z-fixed w-11 h-11 border-0 rounded-lg cursor-pointer flex flex-col items-center justify-center gap-[5px] shadow-md transition-colors',
          'bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]',
          'lg:hidden'
        )}
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls="main-nav"
        aria-label="Toggle navigation menu"
      >
        <span
          className={cn(
            'block w-[22px] h-0.5 bg-[var(--color-text)] rounded-sm transition-all duration-200',
            isOpen && 'rotate-45 translate-y-[7px]'
          )}
        />
        <span
          className={cn(
            'block w-[22px] h-0.5 bg-[var(--color-text)] rounded-sm transition-all duration-200',
            isOpen && 'opacity-0'
          )}
        />
        <span
          className={cn(
            'block w-[22px] h-0.5 bg-[var(--color-text)] rounded-sm transition-all duration-200',
            isOpen && '-rotate-45 -translate-y-[7px]'
          )}
        />
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-modal-backdrop transition-all duration-200',
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
          'fixed top-0 left-0 w-[280px] h-full z-modal flex flex-col shadow-lg transition-transform duration-300',
          'bg-[var(--color-bg-card)]',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:w-auto lg:h-auto lg:translate-x-0 lg:bg-transparent lg:shadow-none lg:flex-row lg:items-center'
        )}
        aria-label="Main navigation"
        aria-hidden={!isOpen}
      >
        {/* Nav Header - Mobile only */}
        <div className="p-6 border-b border-[var(--color-border)] flex items-center gap-3 lg:hidden">
          <Image
            src="/icon-512.png"
            alt=""
            width={32}
            height={32}
            className="rounded-md"
          />
          <span className="font-semibold">LED Matrix Webex</span>
        </div>

        {/* Nav Links */}
        <div className="flex-1 py-4 overflow-y-auto lg:flex lg:p-0 lg:overflow-visible">
          {navItems.map((item, index) => {
            if ('divider' in item && item.divider) {
              return (
                <div
                  key={`divider-${index}`}
                  className="h-px bg-[var(--color-border)] my-2 mx-6 lg:hidden"
                />
              );
            }

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
                  'flex items-center gap-3 px-6 py-3 text-[var(--color-text)] no-underline text-[0.9375rem] transition-all',
                  'hover:bg-[var(--color-bg-hover)] hover:text-primary',
                  active && 'bg-[var(--color-bg-hover)] text-primary border-l-[3px] border-primary lg:border-l-0 lg:bg-white/15 lg:rounded-lg',
                  'lg:px-4 lg:py-2 lg:rounded-lg'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span className="w-5 text-center lg:hidden">{item.icon}</span>
                {item.label}
                {isExternal && <span className="ml-auto opacity-50 text-xs lg:ml-1">↗</span>}
              </Link>
            );
          })}
        </div>

        {/* Nav Footer - Mobile only */}
        <div className="p-4 px-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] lg:hidden">
          <p>v1.2.0 | MIT License</p>
        </div>
      </nav>
    </>
  );
}
