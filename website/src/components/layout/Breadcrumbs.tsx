'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '': 'Home',
  'install': 'Install',
  'hardware': 'Hardware',
  'troubleshooting': 'Troubleshooting',
  'versions': 'Downloads',
  'api-docs': 'API Docs',
  'embedded': 'Embedded App',
};

/**
 * Breadcrumb navigation component
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  
  // Don't show breadcrumbs on homepage
  if (segments.length === 0) return null;
  
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-2 text-sm flex-wrap">
        <li>
          <Link 
            href="/" 
            className="text-[var(--color-text-muted)] hover:text-primary transition-colors"
          >
            Home
          </Link>
        </li>
        {segments.map((segment, index) => {
          const path = `/${segments.slice(0, index + 1).join('/')}`;
          const isLast = index === segments.length - 1;
          const title = PAGE_TITLES[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
          
          return (
            <li key={path} className="flex items-center gap-2">
              <span className="text-[var(--color-text-muted)]" aria-hidden="true">/</span>
              {isLast ? (
                <span className="text-[var(--color-text)] font-medium" aria-current="page">
                  {title}
                </span>
              ) : (
                <Link 
                  href={path} 
                  className="text-[var(--color-text-muted)] hover:text-primary transition-colors"
                >
                  {title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
