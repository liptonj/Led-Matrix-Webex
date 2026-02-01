import type { Metadata } from 'next';
import { EmbeddedPageClient } from './EmbeddedPageClient';

export const metadata: Metadata = {
  title: 'Webex Embedded App',
  description: 'LED Matrix Display control panel for Webex',
};

// Force static export for this route
export const dynamic = 'force-static';

export default function EmbeddedPage() {
  return <EmbeddedPageClient />;
}
