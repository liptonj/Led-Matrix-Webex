'use client';

import { Button, Card } from '@/components/ui';
import { memo } from 'react';

export interface MQTTTabProps {
  mqttBroker: string;
  onMqttBrokerChange: (value: string) => void;
  mqttPort: number;
  onMqttPortChange: (value: number) => void;
  mqttUsername: string;
  onMqttUsernameChange: (value: string) => void;
  mqttPassword: string;
  onMqttPasswordChange: (value: string) => void;
  mqttTopic: string;
  onMqttTopicChange: (value: string) => void;
  hasMqttPassword: boolean;
  displaySensorMac: string;
  onDisplaySensorMacChange: (value: string) => void;
  displayMetric: string;
  onDisplayMetricChange: (value: string) => void;
  isPeerConnected: boolean;
  isSaving: boolean;
  onSaveSettings: () => void;
}

export const MQTTTab = memo(function MQTTTab({ mqttBroker, onMqttBrokerChange, mqttPort, onMqttPortChange, mqttUsername, onMqttUsernameChange, mqttPassword, onMqttPasswordChange, mqttTopic, onMqttTopicChange, hasMqttPassword, displaySensorMac, onDisplaySensorMacChange, displayMetric, onDisplayMetricChange, isPeerConnected, isSaving, onSaveSettings }: MQTTTabProps) {
  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">MQTT Settings</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">Configure MQTT broker connection for sensor data display.</p>
      {!isPeerConnected && <p className="text-sm text-warning mb-4">Connect a display to save changes.</p>}
      <div className="space-y-4">
        <div><label className="block text-sm font-medium mb-2">MQTT Broker</label><input type="text" placeholder="mqtt.example.com" value={mqttBroker} onChange={(e) => onMqttBrokerChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={isSaving} /></div>
        <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-2">Port</label><input type="number" min="1" max="65535" value={mqttPort} onChange={(e) => onMqttPortChange(parseInt(e.target.value, 10) || 1883)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={isSaving} /></div><div><label className="block text-sm font-medium mb-2">Username</label><input type="text" placeholder="Optional" value={mqttUsername} onChange={(e) => onMqttUsernameChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={isSaving} /></div></div>
        <div><label className="block text-sm font-medium mb-2">Password{hasMqttPassword && <span className="ml-2 text-xs text-[var(--color-text-muted)]">(set)</span>}</label><input type="password" placeholder={hasMqttPassword ? "Enter new to change" : "Enter password"} value={mqttPassword} onChange={(e) => onMqttPasswordChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={isSaving} /></div>
        <div><label className="block text-sm font-medium mb-2">Topic</label><input type="text" placeholder="meraki/v1/mt/#" value={mqttTopic} onChange={(e) => onMqttTopicChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] font-mono" disabled={isSaving} /></div>
        <div><label className="block text-sm font-medium mb-2">Display Sensor MAC</label><input type="text" placeholder="AA:BB:CC:DD:EE:FF" value={displaySensorMac} onChange={(e) => onDisplaySensorMacChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)] font-mono" disabled={isSaving} /></div>
        <div><label className="block text-sm font-medium mb-2">Display Metric</label><select value={displayMetric} onChange={(e) => onDisplayMetricChange(e.target.value)} className="w-full p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-[var(--color-text)]" disabled={isSaving}><option value="tvoc">TVOC</option><option value="co2">CO2</option><option value="pm2_5">PM2.5</option><option value="noise">Noise</option></select></div>
      </div>
      <Button variant="primary" onClick={onSaveSettings} disabled={!isPeerConnected || isSaving} className="mt-6">{isSaving ? 'Saving...' : 'Save MQTT Settings'}</Button>
    </Card>
  );
});
