import Link from 'next/link';

export function Footer() {
  return (
    <footer 
      className="text-center py-8 px-4 mt-12"
      style={{ background: 'var(--footer-bg)', color: 'var(--footer-text)' }}
    >
      <div className="container mx-auto">
        <p className="mb-2">Open source project - MIT License</p>
        <p className="mb-0">
          <Link 
            href="https://github.com/liptonj/Led-Matrix-Webex" 
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-light"
          >
            GitHub
          </Link>
        </p>
      </div>
    </footer>
  );
}
