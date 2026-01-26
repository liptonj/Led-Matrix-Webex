import Link from 'next/link';
import { APP_VERSION } from '@/lib/utils';

export function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer 
      className="py-12 px-4 mt-12"
      style={{ background: 'var(--footer-bg)', color: 'var(--footer-text)' }}
    >
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Project Info */}
          <div>
            <h3 className="font-semibold mb-3 text-lg">LED Matrix Webex</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-3 leading-relaxed">
              Open-source LED matrix display for Webex presence status
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Version {APP_VERSION} • MIT License
            </p>
          </div>
          
          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-3">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/install/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  Install Firmware
                </Link>
              </li>
              <li>
                <Link href="/hardware/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  Hardware Guide
                </Link>
              </li>
              <li>
                <Link href="/troubleshooting/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  Troubleshooting
                </Link>
              </li>
              <li>
                <Link href="/api-docs/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  API Documentation
                </Link>
              </li>
            </ul>
          </div>
          
          {/* Resources */}
          <div>
            <h3 className="font-semibold mb-3">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link 
                  href="https://github.com/liptonj/Led-Matrix-Webex" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[var(--color-text-muted)] hover:text-primary transition-colors"
                >
                  GitHub Repository ↗
                </Link>
              </li>
              <li>
                <Link 
                  href="https://github.com/liptonj/Led-Matrix-Webex/issues" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[var(--color-text-muted)] hover:text-primary transition-colors"
                >
                  Report Issue ↗
                </Link>
              </li>
              <li>
                <Link href="/versions/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  Download Firmware
                </Link>
              </li>
              <li>
                <Link href="/embedded/" className="text-[var(--color-text-muted)] hover:text-primary transition-colors">
                  Webex Embedded App
                </Link>
              </li>
            </ul>
          </div>
        </div>
        
        {/* Copyright */}
        <div className="text-center pt-6 border-t border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-text-muted)]">
            © {currentYear} LED Matrix Webex Display Project
          </p>
        </div>
      </div>
    </footer>
  );
}
