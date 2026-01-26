import Link from 'next/link';
import Image from 'next/image';
import { Header, Footer } from '@/components/layout';
import { Card } from '@/components/ui';

const statusExamples = [
  { status: 'active', label: 'Active', image: '/images/display-active.svg' },
  { status: 'meeting', label: 'In Meeting', image: '/images/display-meeting.svg' },
  { status: 'dnd', label: 'Do Not Disturb', image: '/images/display-dnd.svg' },
  { status: 'away', label: 'Away', image: '/images/display-away.svg' },
];

const features = [
  {
    icon: '🌐',
    title: 'Real-time Status',
    description: 'Displays your Webex presence status in real-time on a colorful LED matrix',
  },
  {
    icon: '🔧',
    title: 'Easy Setup',
    description: 'Web-based configuration with WiFi provisioning and OAuth authentication',
  },
  {
    icon: '🔄',
    title: 'OTA Updates',
    description: 'Over-the-air firmware updates with automatic version checking',
  },
  {
    icon: '🏠',
    title: 'Home Assistant',
    description: 'Optional Home Assistant add-on for centralized presence management',
  },
];

const architectureModes = [
  { name: 'Direct Mode', description: 'ESP32-S3 connects directly to Webex API' },
  { name: 'Bridge Mode', description: 'Node.js bridge server handles multiple displays' },
  { name: 'Home Assistant', description: 'Integrated with Home Assistant ecosystem' },
];

export default function HomePage() {
  return (
    <>
      <Header />
      
      <main className="container mx-auto px-4 py-8" id="main-content">
      {/* Hero Section - Status Examples */}
      <section className="section text-center py-8">
        <h2 className="text-2xl font-bold mb-6">See Your Status at a Glance</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {statusExamples.map((item) => (
            <div
              key={item.status}
              className="text-center p-4 rounded-lg bg-[var(--color-surface-alt)] transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="relative w-full aspect-[2/1] mb-3 rounded overflow-hidden border-2 border-[var(--color-border)] bg-black">
                <Image 
                  src={item.image} 
                  alt={`LED display showing ${item.label} status`}
                  fill
                  className={`object-contain status-glow-${item.status}`}
                  priority={item.status === 'active'}
                />
              </div>
              <p className="text-sm font-medium">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start Section */}
      <section className="section">
        <h2 className="text-primary mb-6 text-center">Get Started in 3 Steps</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-6 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              1
            </div>
            <h3 className="text-lg font-semibold mb-2">Install Firmware</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Flash firmware directly from your browser using Web Serial API
            </p>
            <Link href="/install/" className="text-primary text-sm font-medium hover:underline">
              Start Install →
            </Link>
          </div>
          
          <div className="text-center p-6 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              2
            </div>
            <h3 className="text-lg font-semibold mb-2">Connect Hardware</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Wire ESP32-S3 to LED matrix panel following our guide
            </p>
            <Link href="/hardware/" className="text-primary text-sm font-medium hover:underline">
              View Wiring →
            </Link>
          </div>
          
          <div className="text-center p-6 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              3
            </div>
            <h3 className="text-lg font-semibold mb-2">Pair with Webex</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Enter pairing code in Webex app to sync your status
            </p>
            <Link href="/embedded/" className="text-primary text-sm font-medium hover:underline">
              Open App →
            </Link>
          </div>
        </div>
      </section>

        {/* Features Section */}
        <section className="section">
          <h2 className="text-primary mb-4">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-5 rounded-lg bg-[var(--color-surface-alt)] border-l-4 border-primary"
              >
                <h3 className="mb-2 text-base font-semibold">
                  {feature.icon} {feature.title}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-0">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture Section */}
        <section className="section">
          <h2 className="text-primary mb-4">Architecture</h2>
          <p className="mb-4">Three deployment modes to fit your needs:</p>
          <ul className="list-none mt-4 space-y-2">
            {architectureModes.map((mode) => (
              <li
                key={mode.name}
                className="p-3 px-4 rounded-lg bg-[var(--color-surface-alt)] text-[0.9375rem]"
              >
                <strong className="text-primary">{mode.name}:</strong> {mode.description}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <Footer />
    </>
  );
}
