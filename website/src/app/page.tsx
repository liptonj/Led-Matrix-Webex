import Link from 'next/link';
import { Header, Footer } from '@/components/layout';
import { Card } from '@/components/ui';

const statusExamples = [
  { status: 'active', label: 'Active', color: 'text-status-active' },
  { status: 'meeting', label: 'In Meeting', color: 'text-status-meeting' },
  { status: 'dnd', label: 'Do Not Disturb', color: 'text-status-dnd' },
  { status: 'away', label: 'Away', color: 'text-status-away' },
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
            {statusExamples.map((item) => (
              <div
                key={item.status}
                className="text-center p-5 rounded-lg bg-[var(--color-surface-alt)] transition-transform hover:-translate-y-1"
              >
                <div className={`text-5xl mb-2 ${item.color}`}>●</div>
                <p className="text-sm text-[var(--color-text-muted)] mb-0">{item.label}</p>
              </div>
            ))}
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
